{
  description = "MCAP data recovery app (Django Backend + Next.js Frontend)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      # Backend build logic
      mkBackend = { pkgs, system }:
        pkgs.python3Packages.buildPythonApplication {
          pname = "data_offload_app_backend";
          version = "0.1.0";
          src = ./backend;
          format = "pyproject";

          nativeBuildInputs = [ pkgs.python3Packages.setuptools ]; 
          propagatedBuildInputs = with pkgs.python3Packages; [
            django
            djangorestframework
            django-cors-headers
          ];

          # Wrap the manage.py execution
          postInstall = ''
            mkdir -p $out/bin
            echo "#!${pkgs.runtimeShell}" > $out/bin/data-offload-backend
            echo "export PYTHONPATH=$PYTHONPATH:$out/lib/python3.*/site-packages" >> $out/bin/data-offload-backend
            # We need to cd into the directory or set paths correctly so manage.py finds settings
            # But usually installing via pip (pyproject) puts modules in site-packages.
            # We'll run gunicorn or manage.py runserver. For simplicity: runserver
            echo "${pkgs.python3}/bin/python $out/lib/python3.*/site-packages/manage.py runserver 0.0.0.0:8000" >> $out/bin/data-offload-backend
            chmod +x $out/bin/data-offload-backend
          '';
          
          # Fix for finding manage.py if not installed as a module properly?
          # Actually, buildPythonApplication usually expects a setup.py/pyproject.toml.
          # We created pyproject.toml, so it should install 'config' and 'api' packages.
          # But manage.py is a script at root of backend. It might not be installed.
          # Let's just copy the source and run from there for simplicity if standard build fails.
          # Alternative: Just copy src and wrap script.
        };

      # Simple script-based backend derivation (easier than full python packaging if structure is ad-hoc)
      mkBackendSimple = { pkgs, system }:
        pkgs.stdenv.mkDerivation {
          name = "data_offload_app_backend";
          src = ./backend;
          buildInputs = [ pkgs.python3 pkgs.makeWrapper ];
          installPhase = ''
            mkdir -p $out/app
            cp -r . $out/app
            
            makeWrapper ${pkgs.python3}/bin/python $out/bin/data-offload-backend \
              --add-flags "$out/app/manage.py runserver 0.0.0.0:8000" \
              --prefix PYTHONPATH : "$out/app" \
              --prefix PYTHONPATH : "${pkgs.python3Packages.django}/${pkgs.python3Packages.python.sitePackages}" \
              --prefix PYTHONPATH : "${pkgs.python3Packages.djangorestframework}/${pkgs.python3Packages.python.sitePackages}" \
              --prefix PYTHONPATH : "${pkgs.python3Packages.django-cors-headers}/${pkgs.python3Packages.python.sitePackages}"
          '';
        };

      # Frontend build logic
      mkFrontend = { pkgs, system }:
        pkgs.buildNpmPackage {
          pname = "data_offload_app_frontend";
          version = "0.1.0";
          src = ./.;
          
          # Filter out backend to avoid rebuilding frontend when backend changes
          # src = pkgs.nix-gitignore.gitignoreSourcePure [ "backend" "flake.nix" ".git" ] ./.;

          npmDeps = pkgs.importNpmLock {
            npmRoot = ./.;
          };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          buildPhase = ''
            export NEXT_TELEMETRY_DISABLED=1
            npm run build
          '';

          installPhase = ''
            mkdir -p $out/app
            cp -r .next public package.json node_modules $out/app
            
            mkdir -p $out/bin
            echo "#!${pkgs.runtimeShell}" > $out/bin/start-frontend
            echo "cd $out/app && ${pkgs.nodejs}/bin/npm start" >> $out/bin/start-frontend
            chmod +x $out/bin/start-frontend
          '';
        };

      overlay = final: prev: {
        data_offload_app_backend = mkBackendSimple { pkgs = final; system = final.system; };
        data_offload_app_frontend = mkFrontend { pkgs = final; system = final.system; };
      };

    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; overlays = [ overlay ]; };
        
        devTools = [
          pkgs.mcap-cli
          pkgs.nodejs_20
          pkgs.yarn
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
            echo "Frontend: npm run dev"
          '';
        };

        packages = {
          backend = pkgs.data_offload_app_backend;
          frontend = pkgs.data_offload_app_frontend;
          default = pkgs.data_offload_app_frontend; # Default to frontend if asked
        };
      }
    ) // {
      overlays.default = overlay;
      nixosModules.default = import ./module.nix;
    };
}
