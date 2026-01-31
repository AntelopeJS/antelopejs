import { expect } from 'chai';
import { HotReload } from '../../../src/core/watch/hot-reload';

describe('HotReload', () => {
  it('should batch reloads within debounce window', async () => {
    const calls: string[] = [];
    const hotReload = new HotReload(async (id) => {
      calls.push(id);
    }, 10);

    hotReload.queue('a');
    hotReload.queue('b');
    hotReload.queue('a');

    await new Promise((r) => setTimeout(r, 30));

    expect(calls.sort()).to.deep.equal(['a', 'b']);
  });
});
