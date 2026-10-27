import { XMLParser } from 'fast-xml-parser';
import type { RunConfig } from './types';

type XmlNode = Record<string, unknown>;

const ARRAY_TAGS = new Set(['component', 'configuration', 'env', 'script']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

function attr(node: XmlNode | undefined, name: string): string | undefined {
  const value = node?.[`@_${name}`];
  return typeof value === 'string' ? value : undefined;
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  const value = node[name];
  return value && typeof value === 'object' ? (value as XmlNode) : undefined;
}

function children(node: XmlNode | undefined, name: string): XmlNode[] {
  const value = node?.[name];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

function dirnameOf(file: string, fallback: string): string {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return index > 0 ? file.slice(0, index) : fallback;
}

export function parseRunConfigs(
  xml: string,
  projectDir: string,
): { selected: string | null; configs: RunConfig[] } {
  const resolve = (value: string) => value.split('$PROJECT_DIR$').join(projectDir);

  const root = parser.parse(xml) as XmlNode;
  const project = child(root, 'project');
  const runManager = children(project, 'component').find((c) => attr(c, 'name') === 'RunManager');
  if (!runManager) return { selected: null, configs: [] };

  const configs: RunConfig[] = [];
  for (const node of children(runManager, 'configuration')) {
    const name = attr(node, 'name');
    if (!name || attr(node, 'default') === 'true') continue;

    const env: Record<string, string> = {};
    for (const e of children(child(node, 'envs'), 'env')) {
      const envName = attr(e, 'name');
      if (envName) env[envName] = resolve(attr(e, 'value') ?? '');
    }
    const temporary = attr(node, 'temporary') === 'true';

    const type = attr(node, 'type');
    if (type === 'NodeJSConfigurationType') {
      const script = attr(node, 'path-to-js-file');
      if (!script) continue;
      configs.push({
        key: `Node.js.${name}`,
        name,
        type: 'node',
        temporary,
        command: ['node', attr(node, 'node-parameters'), script, attr(node, 'application-parameters')]
          .filter(Boolean)
          .map((part) => resolve(part as string))
          .join(' '),
        cwd: resolve(attr(node, 'working-dir') || projectDir),
        env,
      });
    } else if (type === 'js.build_tools.npm') {
      const subCommand = attr(child(node, 'command'), 'value');
      if (!subCommand) continue;
      const scripts = children(child(node, 'scripts'), 'script')
        .map((s) => attr(s, 'value'))
        .filter((s): s is string => !!s);
      const packageJson = resolve(attr(child(node, 'package-json'), 'value') ?? `${projectDir}/package.json`);
      configs.push({
        key: `npm.${name}`,
        name,
        type: 'npm',
        temporary,
        command: ['npm', subCommand, ...scripts].join(' '),
        cwd: dirnameOf(packageJson, projectDir),
        env,
      });
    }
  }

  return { selected: attr(runManager, 'selected') ?? null, configs };
}
