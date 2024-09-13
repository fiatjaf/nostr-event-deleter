import { SimplePool } from 'nostr-tools';
import { NostrFetcher } from 'nostr-fetch';
import { simplePoolAdapter } from '@nostr-fetch/adapter-nostr-tools-v2'
import { allRelays } from './relays';
import { relaysFound } from './stores/relays-found';

const RELAY_MONITORS = [
  '9ba1d7892cd057f5aca5d629a5a601f64bc3e0f1fc6ed9c939845e25d5e1e254', //nw: sao paulo
  '9ba6484003e8e88600f97ebffd897b2fe82753082e8e0cd8ea19aac0ff2b712b', //nw: newark, nj
  '9bbbb845e5b6c831c29789900769843ab43bb5047abe697870cb50b6fc9bf923', //nw: ams 
  'b2c949c0fb79eaa2837d38e3ef4fe7d57fede6cfc3c00f2cf75c8ccbdad2c8a1'  //rt: monitorlizard
]

export const getOnlineRelays = async () => {
  const pool = new SimplePool();
  const fetcher = NostrFetcher.withCustomPool(simplePoolAdapter(pool));
  
  const relayUrls = ['wss://relaypag.es', 'wss://relay.nostr.watch', 'wss://history.nostr.watch', 'wss://monitorlizard.nostr1.com'];
  
  const postIter = fetcher.allEventsIterator(
    relayUrls, 
    { kinds: [ 30166 ], authors: RELAY_MONITORS },
    { since: Math.floor(Date.now()/1000) - 24 * 60 * 60 },
    { skipVerification: true }
  );
  
  let onlineRelays = new Set();

  console.log('loading online relays...')
  
  for await (const ev of postIter) {
    let url, urlStr 
    try {
      const val = ev.tags.find( t => t[0] === 'd')?.[1]
      url = new URL(val)
      urlStr = url.toString()
    }
    catch(e){
      console.log('invalid url', ev.tags.find( t => t[0] === 'd'))
      continue;
    }
    if(url.protocol !== 'wss:') continue; // only allow wss
    if(onlineRelays.has(urlStr)) continue;
    onlineRelays.add(urlStr)
    relaysFound.set(onlineRelays.size)
  }
  
  if(!onlineRelays.size) {
    console.warn('Could not find any online relays, falling back to static set of relays.')
    onlineRelays = new Set(allRelays)
  }
  
  return Array.from(onlineRelays)
}
