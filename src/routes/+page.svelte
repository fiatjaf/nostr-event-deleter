<script lang="ts">
  import type {Event, EventTemplate} from 'nostr-tools/pure'
  import {
    decode,
    type EventPointer,
    type AddressPointer
  } from 'nostr-tools/nip19'
  import {SimplePool} from 'nostr-tools/pool'

  import {commonRelays, metadataRelays} from '../relays.js'

  import {getOnlineRelays} from '../online-relays.js' 

  import {relaysFound} from '../stores/relays-found';

  /**/
  const CONCURRENCY = 30;
  const DELAY       = 1000;
  /**/

  let pool = new SimplePool()
  let id: string | null = null
  let a: string | null = null
  let relayGroups: [string, string[], null | (() => void)][] = [
    ['common', commonRelays, null],
    ['hints', [], null],
    ['kind10002', [], fetchKind10002Relays],
    ['kind3', [], fetchKind3Relay],
    ['extension', [], fetchExtensionRelays],
    ['all relays', [], fetchAllRelays]
  ]
  let tryingFetching: {[index: number]: boolean} = {}
  let triedFetching: {[index: number]: boolean} = {}
  let tried: {[url: string]: boolean} = {}
  let statuses: {[url: string]: boolean | string} = {}

  $: validId = id && id.match(/^[0-9a-f]{64}$/)

  function handleInput(
    ev: Event & {currentTarget: EventTarget & HTMLInputElement}
  ) {
    id = (ev.currentTarget as HTMLInputElement).value || ''
    a = null
    statuses = {}
    tried = {}

    let res = decode(id)
    switch (res.type) {
      case 'note': {
        id = res.data as string
        a = null
        break
      }
      case 'nevent': {
        let data = res.data as EventPointer
        relayGroups[1][1] = data.relays || []
        id = data.id
        a = null
        break
      }
      case 'naddr': {
        let data = res.data as AddressPointer
        relayGroups[1][1] = data.relays || []
        a = `${data.kind}:${data.pubkey}:${data.identifier}`
        id = null
        break
      }
    }
  }

  async function handleDelete(r: number) {
    let deleteEvent: EventTemplate = {
      content: '',
      created_at: Math.round(Date.now() / 1000),
      tags: [],
      kind: 5
    };

    if (validId) {
      deleteEvent.tags.push(['e', id as string]);
    } else if (a) {
      deleteEvent.tags.push(['a', a]);
    } else return;

    let signedDeleteEvent: Event = await (window as any).nostr.signEvent(deleteEvent);

    const publishToRelay = async (url: string) => {
      if (tried[url]) return;
      tried[url] = true;

      try {
        await Promise.race([
          pool.ensureRelay(url).then(async (relay) => { 
            await relay.publish(signedDeleteEvent)
            relay.close()
          }),
          new Promise((_, reject) => setTimeout(() => reject('timed out'), 5000))
        ]);
        statuses[url] = true;
      } catch (err) {
        statuses[url] = err?.message ?? false;
      }
    };

    const relayUrls = relayGroups[r][1];
    const promises = [];

    for (let u = 0; u < relayUrls.length; u++) {
      let url = relayUrls[u];
      promises.push(publishToRelay(url));

      if (promises.length === CONCURRENCY || u === relayUrls.length - 1) {
        await Promise.all(promises);
        promises.length = 0;
        pool.destroy();
        await new Promise(resolve => setTimeout(resolve, DELAY));
      }
    }
  }

  async function fetchKind10002Relays() {
    let pubkey = await (window as any).nostr.getPublicKey()
    let res = await pool.querySync(metadataRelays, {
      kinds: [10002],
      authors: [pubkey]
    })
    res.forEach(evt => {
      evt.tags.forEach((tag: string[]) => {
        if (tag[0] === 'r' && tag[1]?.length) {
          relayGroups[2][1].push(tag[1])
        }
      })
    })
    relayGroups[2][1] = relayGroups[2][1]
  }

  async function fetchKind3Relay() {
    let pubkey = await (window as any).nostr.getPublicKey()
    let res = await pool.querySync(metadataRelays, {
      kinds: [3],
      authors: [pubkey]
    })
    res.forEach(evt => {
      try {
        relayGroups[3][1].push(...Object.keys(JSON.parse(evt.content)))
      } catch (err) {
        /***/
      }
    })
    relayGroups[3][1] = relayGroups[3][1]
  }

  async function fetchExtensionRelays() {
    relayGroups[4][1] = Object.keys(await (window as any).nostr.getRelays())
  }

  async function fetchAllRelays() {
    relayGroups[5][1] = await getOnlineRelays()
    tryingFetching[5] = false
  }
</script>

<main class="m-4">
  <h1 class="my-2 text-2xl">nostr event deleter</h1>
  <label class="mr-4 mb-2">
    paste event id (hex, nevent1, naddr1 or note1 code) to be deleted:
    <input class="block outline-none mt-2 w-full" on:input={handleInput} />
  </label>
  <div class="flex flex-wrap items-start content-start">
    {#if validId || a}
      {#each relayGroups as rg, r}
        {#if rg[1].length > 0 || (rg[2] && !triedFetching[r])}
          <section class="mr-4 mb-2 border rounded px-4 py-2 w-48 truncate">
            <div class="flex items-center justify-between">
              <span class="font-bold text-lg text-center">{rg[0]}</span>
              {#if rg[1].length === 0 && rg[2] && !tryingFetching[r]}
                <button
                  class="my-2 px-2 py-1 rounded text-white bg-zinc-700 cursor-pointer hover:bg-zinc-600"
                  on:click={() => {
                    tryingFetching[r] = true
                    rg[2]?.().finally(() => {
                      triedFetching[r] = true
                    })
                  }}>load</button
                >
              {:else if tryingFetching[r]}
                <span class="my-2 px-2 py-1 rounded">
                  {$relaysFound}
                </span>
              {:else if rg[1].length}
                <button
                  class={'my-2 px-2 py-1 rounded text-white ' +
                    (rg[1].every(url => tried[url])
                      ? 'bg-zinc-400'
                      : 'bg-pink-700 cursor-pointer hover:bg-pink-600')}
                  disabled={rg[1].every(url => tried[url])}
                  on:click={() => handleDelete(r)}>delete</button
                >
              {/if}
            </div>
            <ul>
              {#each rg[1] as url}
                <li class="group">
                  <div class="flex items-center">
                    <span
                      class:text-green-500={statuses[url] === true}
                      class:text-red-500={statuses[url] === false ||
                        typeof statuses[url] === 'string'}
                      class:text-yellow-600={statuses[url] === undefined &&
                        tried[url] === true}
                      class="text-4xl mr-2"
                    >
                      •
                    </span>
                    {url.replace('wss://', '')}
                  </div>
                  {#if typeof statuses[url] === 'string'}
                    <div
                      class="hidden group-hover:block text-xs text-amber-700"
                    >
                      {statuses[url]}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/each}
    {/if}
  </div>
</main>
