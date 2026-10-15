// Large source baselines belong in IndexedDB. Small drafts keep their legacy
// localStorage keys, with IndexedDB as a durable fallback when that quota is full.
export async function createDraftStorage({localStorage,indexedDB,onError=()=>{}}) {
  const cached=new Map(),failed=new Set();
  let database=null,queue=Promise.resolve();
  const isBaseline=key=>(key.startsWith('html-editor-draft:')||key.startsWith('jx-visual-editor-'))&&key.endsWith('-source-base');
  const readLocal=key=>{try{return localStorage.getItem(key);}catch{return null;}};
  function transaction(action) {
    return new Promise((resolve,reject)=>{
      if(!database){reject(new Error('浏览器持久存储不可用'));return;}
      const tx=database.transaction('drafts','readwrite');
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error||new Error('浏览器草稿写入失败'));
      tx.onerror=()=>{};
      try{action(tx.objectStore('drafts'));}catch(error){reject(error);}
    });
  }
  function enqueue(key,action) {
    queue=queue.then(()=>transaction(action)).then(()=>failed.delete(key)).catch(error=>{failed.add(key);onError(error);});
  }
  try {
    database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('html-editor-drafts',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('浏览器草稿数据库被其他页面占用'));
    });
    await new Promise((resolve,reject)=>{
      const tx=database.transaction('drafts','readonly');
      const request=tx.objectStore('drafts').openCursor();
      request.onsuccess=()=>{const cursor=request.result;if(cursor){cached.set(cursor.key,cursor.value);cursor.continue();}};
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
    // Migrate all legacy HTML copies to free space without discarding any draft.
    const baselines=[];
    for(let i=0;i<localStorage.length;i++) {
      const key=localStorage.key(i);
      if(key&&isBaseline(key))baselines.push([key,readLocal(key)]);
    }
    for(const [key,value] of baselines) {
      if(value===null)continue;
      if(!cached.has(key)) {
        await transaction(store=>store.put(value,key));
        cached.set(key,value);
      }
      localStorage.removeItem(key);
    }
  }catch(error){onError(error);}
  return {
    getItem(key){return cached.has(key)?cached.get(key):readLocal(key);},
    setItem(key,value) {
      value=String(value);
      if(!isBaseline(key)||!database) {
        try {
          localStorage.setItem(key,value);
          if(cached.has(key)&&database)enqueue(key,store=>store.delete(key));
          cached.delete(key);failed.delete(key);
          return;
        }catch{}
      }
      cached.set(key,value);
      enqueue(key,store=>store.put(value,key));
    },
    removeItem(key) {
      cached.set(key,null);
      try{localStorage.removeItem(key);}catch{}
      if(database)enqueue(key,store=>store.delete(key));
    },
    async flush(){await queue;return failed.size===0;},
  };
}
