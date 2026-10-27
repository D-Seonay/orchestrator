import { describe, it, expect } from 'vitest';
import { parseRunConfigs } from '@/lib/intellij';

const DIR = 'C:/x/base';

function workspace(selected: string | null, configs: string) {
  const sel = selected === null ? '' : ` selected="${selected}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="RunManager"${sel}>
${configs}
  </component>
</project>`;
}

const NODE_CONFIG = `
    <configuration name="test" type="NodeJSConfigurationType" node-parameters="--inspect-brk" path-to-js-file="app.js" working-dir="$PROJECT_DIR$">
      <envs>
        <env name="PORT" value="3000" />
      </envs>
      <method v="2" />
    </configuration>`;

describe('parseRunConfigs', () => {
  it('parses a Node.js config with node parameters', () => {
    const { configs } = parseRunConfigs(workspace('Node.js.test', NODE_CONFIG), DIR);
    expect(configs).toEqual([
      {
        key: 'Node.js.test',
        name: 'test',
        type: 'node',
        temporary: false,
        command: 'node --inspect-brk app.js',
        cwd: 'C:/x/base',
        env: { PORT: '3000' },
      },
    ]);
  });

  it('parses an npm run config', () => {
    const xml = workspace(null, `
    <configuration name="start" type="js.build_tools.npm" temporary="true" nameIsGenerated="true">
      <package-json value="$PROJECT_DIR$/sub/package.json" />
      <command value="run" />
      <scripts>
        <script value="start" />
      </scripts>
      <node-interpreter value="project" />
      <envs />
      <method v="2" />
    </configuration>`);
    const { configs } = parseRunConfigs(xml, DIR);
    expect(configs).toEqual([
      {
        key: 'npm.start',
        name: 'start',
        type: 'npm',
        temporary: true,
        command: 'npm run start',
        cwd: 'C:/x/base/sub',
        env: {},
      },
    ]);
  });

  it('parses an npm start config without scripts', () => {
    const xml = workspace(null, `
    <configuration name="start" type="js.build_tools.npm">
      <package-json value="$PROJECT_DIR$/package.json" />
      <command value="start" />
      <envs />
      <method v="2" />
    </configuration>`);
    const { configs } = parseRunConfigs(xml, DIR);
    expect(configs[0]).toMatchObject({ key: 'npm.start', command: 'npm start', cwd: 'C:/x/base', temporary: false });
  });

  it('reads selected attribute', () => {
    expect(parseRunConfigs(workspace('npm.start', NODE_CONFIG), DIR).selected).toBe('npm.start');
    expect(parseRunConfigs(workspace(null, NODE_CONFIG), DIR).selected).toBeNull();
  });

  it('decodes XML entities and $PROJECT_DIR$ in env values', () => {
    const xml = workspace(null, `
    <configuration name="app.js" type="NodeJSConfigurationType" path-to-js-file="app.js" working-dir="$PROJECT_DIR$">
      <envs>
        <env name="SECRET" value="a&amp;b&quot;c" />
        <env name="JWT_DIR" value="$PROJECT_DIR$/jwt" />
      </envs>
    </configuration>`);
    const { configs } = parseRunConfigs(xml, DIR);
    expect(configs[0].env).toEqual({ SECRET: 'a&b"c', JWT_DIR: 'C:/x/base/jwt' });
  });

  it('ignores docker and karma configurations', () => {
    const xml = workspace('Docker.Dockerfile', `
    <configuration name="Dockerfile" type="docker-deploy" factoryName="dockerfile">
      <deployment type="dockerfile" />
    </configuration>
    <configuration name="karma" type="KarmaRunConfigurationType" working-dir="$PROJECT_DIR$" />
    <configuration name="dbg" type="JavascriptDebugType" uri="http://localhost:4200" />
    <configuration default="true" type="NodeJSConfigurationType" working-dir="$PROJECT_DIR$" path-to-js-file="x.js" />
    ${NODE_CONFIG}`);
    const { selected, configs } = parseRunConfigs(xml, DIR);
    expect(selected).toBe('Docker.Dockerfile');
    expect(configs.map((c) => c.key)).toEqual(['Node.js.test']);
  });

  it('returns nothing when there is no RunManager component', () => {
    expect(parseRunConfigs('<project version="4"><component name="Other" /></project>', DIR)).toEqual({
      selected: null,
      configs: [],
    });
  });
});
