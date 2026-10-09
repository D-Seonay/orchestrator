import { describe, it, expect } from 'vitest';
import { formatUptime, parseEnv, stripAnsi, isErrorLog } from '@/lib/utils';

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

describe('parseEnv', () => {
  it('retourne un objet vide si le contenu est vide', () => {
    expect(parseEnv('')).toEqual({});
  });

  it('parse les paires KEY=VALUE', () => {
    expect(parseEnv('FOO=bar\nBAZ=qux\n')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignore les commentaires et lignes vides', () => {
    expect(parseEnv('# commentaire\n\nKEY=value\n')).toEqual({ KEY: 'value' });
  });

  it('retire les guillemets autour des valeurs', () => {
    expect(parseEnv('A="hello world"\nB=\'single\'\n')).toEqual({ A: 'hello world', B: 'single' });
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

describe('isErrorLog', () => {
  it('ignore les logs debug sur STDERR', () => {
    expect(isErrorLog('[09:57:19] STDERR: debug: -------------------------------------------------------')).toBe(false);
    expect(isErrorLog('[09:57:19] STDERR: debug: Environment : development')).toBe(false);
    expect(isErrorLog('[09:57:19] STDERR: debug: Port        : 4430')).toBe(false);
    expect(isErrorLog('[09:57:19] STDERR: debug: Local       : http://localhost:4430')).toBe(false);
  });

  it('ignore les avertissements et informations', () => {
    expect(isErrorLog('[warn] deprecated module')).toBe(false);
    expect(isErrorLog('info: Server is listening on port 3000')).toBe(false);
    expect(isErrorLog('Compiled successfully with 0 errors and 1 warning')).toBe(false);
  });

  it('détecte les vraies erreurs applicatives', () => {
    expect(isErrorLog('[09:57:19] STDERR: Error: connect ECONNREFUSED 127.0.0.1:5432')).toBe(true);
    expect(isErrorLog('Fatal error: out of memory')).toBe(true);
    expect(isErrorLog('Error: listen EADDRINUSE: address already in use :::3000')).toBe(true);
    expect(isErrorLog('UnhandledPromiseRejection: connection lost')).toBe(true);
    expect(isErrorLog('Command failed with exit code 1')).toBe(true);
  });
});
