{ config, lib, pkgs, ... }:

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

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Port for the Next.js frontend";
    };
    
    backendPort = lib.mkOption {
      type = lib.types.port;
      default = 8000;
      description = "Port for the Django backend";
    };
  };

  config = lib.mkIf cfg.enable {
    # Open firewall ports
    networking.firewall.allowedTCPPorts = [ cfg.port cfg.backendPort ];

    # Backend Service (Django)
    systemd.services.data_offload_backend = {
      description = "Data Offload Backend (Django)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        BASE_DIR = cfg.baseDir;
        DJANGO_SETTINGS_MODULE = "config.settings";
        PYTHONUNBUFFERED = "1";
      };
      path = [ pkgs.mcap-cli ]; # Ensure mcap CLI is available
      serviceConfig = {
        # We assume the package provides a 'run-backend' script or we invoke python directly
        ExecStart = "${pkgs.data_offload_app_backend}/bin/data-offload-backend";
        Restart = "always";
        User = "nixos"; # Or make configurable
        Group = "users";
      };
    };

    # Frontend Service (Next.js)
    systemd.services.data_offload_frontend = {
      description = "Data Offload Frontend (Next.js)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" "data_offload_backend.service" ];
      environment = {
        PORT = toString cfg.port;
        NEXT_PUBLIC_API_URL = "http://localhost:${toString cfg.backendPort}";
        HOSTNAME = "0.0.0.0";
      };
      serviceConfig = {
        ExecStart = "${pkgs.data_offload_app_frontend}/bin/start-frontend";
        Restart = "always";
        User = "nixos";
        Group = "users";
      };
    };
  };
}

