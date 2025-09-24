{ 
  description = "A flake for the data offload utility";

  inputs = { 
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }: 
    flake-utils.lib.eachDefaultSystem (system:
    let
      pkgs = import nixpkgs { inherit system; };

      name = "data_offload_app"; 

      devTools = { system, pkgs }: [
        pkgs.mcap-cli
        pkgs.nodejs
      ];

      devShell = pkgs.mkShell { 
        buildInputs = (devTools { system = system; pkgs = pkgs; });
      };

      app = { name, pkgs, system, ... }: pkgs.buildNpmPackage {
        pname = name;
        version = "0.1.0";

        src = ./.;

        npmDeps = pkgs.importNpmLock {
          npmRoot = ./.;
        };

        npmConfigHook = pkgs.importNpmLock.npmConfigHook;

        installPhase = ''
          runHook preInstall
        
          mkdir -p $out
          cp -r ./* ./.* $out/
        
          runHook postInstall
        '';
      };

    in {
      devShells.default = devShell; 

      packages.default = app {
          name = name;
          pkgs = pkgs;
          system = system;
      };
    }
  ); 
}
