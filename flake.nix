{
  description = "MCAP data recovery app (Django Backend)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    copyparty.url = "github:9001/copyparty";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, copyparty, flake-utils, ... }@inputs:
    let
      lib = nixpkgs.lib;

      # Overlay providing the backend package and aliases matching the existing module expectations.
      ksumsOverlay = final: prev:
        let
          python = final.python3;
        in {
          ksums-data-offload = final.stdenv.mkDerivation {
            pname = "ksums-data-offload";
            version = "0.1.0";

            src = ./backend;

            nativeBuildInputs = [ final.makeWrapper ];

            buildInputs = with final.python3Packages; [
              django
              djangorestframework
              django-cors-headers
              gunicorn
              asgiref
            ];

            dontBuild = true;
            dontConfigure = true;

            installPhase = ''
              runHook preInstall

              mkdir -p $out/lib/ksums
              cp -r $src/* $out/lib/ksums/

              mkdir -p $out/bin

              makeWrapper ${final.python3Packages.gunicorn}/bin/gunicorn $out/bin/ksums-backend \
                --chdir $out/lib/ksums \
                --set PYTHONPATH "$out/lib/ksums:${final.python3Packages.django}/${python.sitePackages}:${final.python3Packages.djangorestframework}/${python.sitePackages}:${final.python3Packages.django-cors-headers}/${python.sitePackages}:${final.python3Packages.asgiref}/${python.sitePackages}" \
                --set DJANGO_SETTINGS_MODULE "config.settings" \
                --add-flags "config.wsgi:application" \
                --add-flags "--bind 0.0.0.0:8000" \
                --add-flags "--workers 2" \
                --add-flags "--timeout 600"

              makeWrapper ${python}/bin/python $out/bin/ksums-manage \
                --set PYTHONPATH "$out/lib/ksums:${final.python3Packages.django}/${python.sitePackages}:${final.python3Packages.djangorestframework}/${python.sitePackages}:${final.python3Packages.django-cors-headers}/${python.sitePackages}:${final.python3Packages.asgiref}/${python.sitePackages}" \
                --set DJANGO_SETTINGS_MODULE "config.settings" \
                --add-flags "$out/lib/ksums/manage.py"

              runHook postInstall
            '';
          };

          # Alias to keep the previous attribute name functional.
          data_offload_app_backend = final.ksums-data-offload;
        };

    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ ksumsOverlay copyparty.overlays.default ];
        };

        devTools = [
          pkgs.mcap-cli
          pkgs.python3
          pkgs.uv
        ];
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = devTools;
          shellHook = ''
            export NEXT_TELEMETRY_DISABLED=1
            echo "Dev shell ready."
            echo "Backend: cd backend && python manage.py runserver"
          '';
        };

        packages = {
          backend = pkgs.ksums-data-offload;
          default = pkgs.ksums-data-offload;
        };
      }
    ) // {
      overlays.default = ksumsOverlay;
      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.data_offload_app;
        in {
          options.services.data_offload_app = {
            enable = lib.mkEnableOption "Data Offload App Service";

            baseDir = lib.mkOption {
              type = lib.types.path;
              default = "/home/nixos/recordings";
              description = "Directory containing .mcap files to recover";
            };

            user = lib.mkOption {
              type = lib.types.str;
              default = "nixos";
              description = "User account used to run the services.";
            };

            group = lib.mkOption {
              type = lib.types.str;
              default = "users";
              description = "Group used to run the services.";
            };

            backendPackage = lib.mkOption {
              type = lib.types.package;
              default = pkgs.ksums-data-offload;
              description = "Package that provides the ksums-backend executable.";
            };

            backendPort = lib.mkOption {
              type = lib.types.port;
              default = 8000;
              description = "Port for the Django backend";
            };
          };

          config = lib.mkIf cfg.enable {
            networking.firewall.allowedTCPPorts = [ cfg.backendPort ];

            systemd.tmpfiles.rules = [
              "d ${cfg.baseDir} 0755 ${cfg.user} ${cfg.group} -"
            ];

            systemd.services.data_offload_backend = {
              description = "Data Offload Backend (Django)";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];
              environment = {
                BASE_DIR = cfg.baseDir;
                DJANGO_SETTINGS_MODULE = "config.settings";
                PYTHONUNBUFFERED = "1";
              };
              path = [ pkgs.mcap-cli ];
              serviceConfig = {
                ExecStart = "${cfg.backendPackage}/bin/ksums-backend --bind 0.0.0.0:${toString cfg.backendPort}";
                Restart = "always";
                User = cfg.user;
                Group = cfg.group;
                WorkingDirectory = cfg.baseDir;
              };
            };
          };
        };

      nixosConfigurations.rpi3 = lib.nixosSystem {
        system = "aarch64-linux";
        modules = [
          "${nixpkgs}/nixos/modules/installer/sd-card/sd-image-aarch64.nix"
          copyparty.nixosModules.default
          self.nixosModules.default
          ({ config, pkgs, lib, ... }: {
            nixpkgs.overlays = [
              copyparty.overlays.default
              ksumsOverlay
            ];

            boot.loader.grub.enable = false;
            boot.loader.generic-extlinux-compatible.enable = true;

            hardware.enableRedistributableFirmware = true;
            hardware.deviceTree = {
              enable = true;
              filter = "bcm2837-rpi-3-b*.dtb";
            };

            networking.hostName = "ksums-pi";
            i18n.defaultLocale = "en_US.UTF-8";
            time.timeZone = "America/New_York";
            nix.settings.experimental-features = [ "nix-command" "flakes" ];

            networking.useNetworkd = false;
            networking.useDHCP = false;
            networking.interfaces.enu1u1 = {
              useDHCP = false;
              ipv4.addresses = [{
                address = "192.168.1.50";
                prefixLength = 24;
              }];
            };
            networking.defaultGateway = "192.168.1.1";
            networking.nameservers = [ "1.1.1.1" "8.8.8.8" ];
            networking.firewall = {
              enable = true;
              allowedTCPPorts = [ 22 3923 8000 ];
            };

            users.users.tochi = {
              isNormalUser = true;
              home = "/home/tochi";
              extraGroups = [ "wheel" "networkmanager" ];
              initialPassword = "changeme";
            };
            security.sudo.wheelNeedsPassword = false;
            services.openssh.enable = true;
            services.openssh.settings = {
              PasswordAuthentication = true;
              PermitRootLogin = "no";
            };
            services.getty.autologinUser = "tochi";

            systemd.tmpfiles.rules = [
              "d /srv/copyparty 0755 tochi users -"
            ];

            services.copyparty = {
              enable = true;
              user = "tochi";
              group = "users";
              settings = {
                i = "0.0.0.0";
                p = [ 3923 ];
                no-reload = true;
              };
              volumes."/" = {
                path = "/srv/copyparty";
                access = { r = "*"; rw = [ "*" ]; };
              };
              openFilesLimit = 8192;
            };

            services.data_offload_app = {
              enable = true;
              baseDir = "/srv/copyparty";
              backendPort = 8000;
              user = "tochi";
              group = "users";
              backendPackage = pkgs.ksums-data-offload;
            };

            environment.systemPackages = with pkgs; [
              git
              mcap-cli
              copyparty
              ksums-data-offload
              vim
            ];

            system.stateVersion = "24.11";
          })
        ];
      };

      images.rpi3 = self.nixosConfigurations.rpi3.config.system.build.sdImage;
    };
}
