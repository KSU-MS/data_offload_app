{ 
  description = "A flake for the data offload utility";

  inputs = { 
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      name = "data_offload_app";

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

      overlay = final: prev: {
        ${name} = app {
          name = name;
          pkgs = final;
          system = final.system;
        };
      };
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system overlay; };

        devTools = [
          pkgs.mcap-cli
          pkgs.nodejs
          pkgs.dash
        ];
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = devTools;
        };

        packages.default = app {
          name = name;
          pkgs = pkgs;
          system = system;
        };
      }
    ) // {
      overlays.default = overlay;
    };
}
