/// <reference types="astro/client" />

/** 自作の YAML パーサ（依存ゼロ、scripts/lib と共用）。 */
declare module "*/mini-yaml.mjs" {
  export function parseYaml(source: string): unknown;
}
