import { describe, it, expect } from 'vitest';
import { formatUptime, parseEnvFile, stripAnsi } from '@/lib/utils';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('formatUptime', () => {
  it('retourne les secondes seules en dessous de 60', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(59)).toBe('59s');
  });

  it('retourne minutes et secondes entre 60 et 3599', () => {
    expect(formatUptime(60)).toBe('1m 0s');
    expect(formatUptime(90)).toBe('1m 30s');
    expect(formatUptime(3599)).toBe('59m 59s');
  });

  it('retourne heures minutes secondes à partir de 3600', () => {
    expect(formatUptime(3600)).toBe('1h 0m 0s');
    expect(formatUptime(3661)).toBe('1h 1m 1s');
    expect(formatUptime(7384)).toBe('2h 3m 4s');
  });
});

describe('parseEnvFile', () => {
  it('retourne un objet vide si le fichier n\'existe pas', () => {
    expect(parseEnvFile('/chemin/inexistant/.env')).toEqual({});
  });

  it('parse les paires KEY=VALUE', () => {
    const tmp = path.join(os.tmpdir(), '.env-test-' + Date.now());
    fs.writeFileSync(tmp, 'FOO=bar\nBAZ=qux\n');
    expect(parseEnvFile(tmp)).toEqual({ FOO: 'bar', BAZ: 'qux' });
    fs.unlinkSync(tmp);
  });

  it('ignore les commentaires et lignes vides', () => {
    const tmp = path.join(os.tmpdir(), '.env-test2-' + Date.now());
    fs.writeFileSync(tmp, '# commentaire\n\nKEY=value\n');
    expect(parseEnvFile(tmp)).toEqual({ KEY: 'value' });
    fs.unlinkSync(tmp);
  });

  it('retire les guillemets autour des valeurs', () => {
    const tmp = path.join(os.tmpdir(), '.env-test3-' + Date.now());
    fs.writeFileSync(tmp, 'A="hello world"\nB=\'single\'\n');
    expect(parseEnvFile(tmp)).toEqual({ A: 'hello world', B: 'single' });
    fs.unlinkSync(tmp);
  });
});

describe('stripAnsi', () => {
  it('supprime les codes couleur ANSI', () => {
    expect(stripAnsi('\x1b[32mBuilding...\x1b[0m')).toBe('Building...');
    expect(stripAnsi('\x1b[1m\x1b[33mWarning\x1b[39m\x1b[22m')).toBe('Warning');
  });

  it('supprime les codes gras/souligné', () => {
    expect(stripAnsi('\x1b[1mInitial chunk files\x1b[22m')).toBe('Initial chunk files');
  });

  it('laisse le texte sans codes inchangé', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
    expect(stripAnsi('')).toBe('');
  });
});
