import * as os from 'os';

export function expandHome(input: string): string {
  const homeDir = os.homedir();

  if (input.startsWith('~')) {
    return homeDir + input.slice(1);
  }

  if (input.includes('~')) {
    const parts = input.split('~');
    if (parts[0].startsWith(homeDir)) {
      return homeDir + '/' + parts[1].replace(/^\/+/, '');
    }
    return input.replace(/~/g, homeDir).replace(/\/+/, '/');
  }

  return input;
}
