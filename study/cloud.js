'use strict';

((root) => {
  const TABLE = 'study_journals';
  const FIELDS = 'revision,snapshot';
  const OWNER_USERNAME = 'terabyte';
  const OWNER_EMAIL = `${OWNER_USERNAME}@study.terabyte.top`;

  function createJournal(client, userId, initialRecord, StoreError) {
    const journals = () => client.from(TABLE);
    const unavailable = () => new StoreError('云端记录暂时无法读写，请检查网络和 Supabase 配置后重试。', 503);
    const select = fields => journals().select(fields).eq('user_id', userId).maybeSingle();

    async function read() {
      let { data, error } = await select(FIELDS);
      if (error) throw unavailable();
      if (!data) {
        const { revision, ...snapshot } = initialRecord();
        ({ data, error } = await journals().insert({ user_id: userId, revision, snapshot }).select(FIELDS).single());
        if (error?.code === '23505') ({ data, error } = await select(FIELDS));
        if (error || !data) throw unavailable();
      }

      return { ...data.snapshot, revision: data.revision };
    }

    async function revision() {
      const { data, error } = await select('revision');
      if (error) throw unavailable();
      return data?.revision;
    }

    async function update(record, previousRevision) {
      const { revision, ...snapshot } = record;
      const { data, error } = await journals().update({ revision, snapshot }).eq('user_id', userId)
        .eq('revision', previousRevision).select('revision').maybeSingle();
      if (error) throw unavailable();
      return Boolean(data);
    }

    return { read, revision, update };
  }

  function cachedAccount(local, remote, scope, report) {
    const cache = local.createStore(root, null, scope);
    let syncing;

    function sync() {
      if (!syncing) {
        const run = async () => {
          if (!root.navigator.onLine) throw new local.StoreError('当前离线。', 503);
          const cached = await cache.transact(record => ({ result: record }), true);
          const { cloud_base: base, ...snapshot } = cached;
          const pending = base != null && cached.revision > base;
          let cloud;
          if (pending) {
            // The revision filter is the write guard. Read the full record only to recover a lost response or report a conflict.
            const saved = await remote.update(snapshot, base);
            cloud = saved ? snapshot : await remote.read();
            if (!saved && (!snapshot.sync_commit || cloud.sync_commit !== snapshot.sync_commit)) throw new local.StoreError('云端有更新，本机修改已保留。', 409);
          } else {
            cloud = base != null && await remote.revision() === base ? snapshot : await remote.read();
          }
          const result = await cache.transact(record => {
            if (record.cloud_base !== base) return { result: { pending: record.revision > record.cloud_base, revision: record.revision } };
            if (base == null || (!pending && record.revision === base && cloud.revision !== base)) {
              return { record: { ...cloud, cloud_base: cloud.revision }, result: { pending: false, revision: cloud.revision } };
            }
            if (pending) return { record: { ...record, cloud_base: cloud.revision }, result: { pending: record.revision > cloud.revision } };
            return { result: { pending: record.revision > record.cloud_base } };
          });
          report(result.pending ? '本机已保存，等待同步' : '云端已同步');
          return result;
        };
        const work = root.navigator.locks ? root.navigator.locks.request(cache.databaseName, run) : run();
        syncing = work.catch(error => {
          report(error.status === 409 ? '同步冲突，本机修改已保留' : '云端暂不可用，继续使用本机缓存');
          throw error;
        }).finally(() => { syncing = null; });
      }
      return syncing;
    }

    const transact = async (operation, readOnly) => {
      const apply = () => cache.transact(record => {
        if (record.cloud_base == null) return { result: null };
        const outcome = operation(record);
        const result = { value: outcome.result, changed: Boolean(outcome.record) };
        if (!outcome.record) return { result };
        return { record: { ...outcome.record, sync_commit: root.crypto.randomUUID() }, result };
      }, readOnly);
      let outcome = await apply();
      if (!outcome) {
        await sync();
        outcome = await apply();
      }
      if (outcome.changed) sync().then(({ pending }) => { if (pending) sync().catch(() => {}); }).catch(() => {});
      return outcome.value;
    };
    async function useCloud(revision) {
      const cloud = await remote.read();
      await cache.transact(record => {
        if (record.revision !== revision) throw new local.StoreError('本机记录已更新，请重新备份。', 409);
        return { record: { ...cloud, cloud_base: cloud.revision } };
      });
    }
    const migrated = () => cache.transact(record => ({ result: Boolean(record.local_imported) }), true);
    return { store: local.createStore(root, transact), sync, useCloud, migrated };
  }

  let sdkPromise;
  function loadSdk() {
    if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
      const script = root.document.createElement('script');
      script.src = new URL('./vendor/supabase.js', root.document.baseURI).href;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error('登录组件暂时无法载入，请重试。'));
      };
      root.document.head.append(script);
    }).catch((error) => { sdkPromise = null; throw error; });
    return sdkPromise;
  }

  const config = root.STUDY_CLOUD_CONFIG || {};
  const configured = Boolean(config.url || config.publishableKey || config.ownerUserId);
  let client;

  async function connect() {
    let url;
    try { url = new URL(config.url); } catch { /* Invalid configuration is reported below. */ }
    if (url?.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
        !/^sb_publishable_[\w-]+$/.test(config.publishableKey)) {
      throw new Error('请在 cloud-config.js 填写 Supabase Project URL 和 Publishable key。');
    }
    const ownerId = (config.ownerUserId || '').toLowerCase();
    if (ownerId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ownerId)) {
      throw new Error('请在 cloud-config.js 填写 Authentication → Users 中的用户 UID。');
    }
    await loadSdk();
    client ||= root.supabase.createClient(url.origin, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    const storageKey = `study-account:${url.host}`;
    const { data, error } = await client.auth.getSession();
    let user = data.session?.user || null;
    if (error) {
      if (error.name !== 'AuthRetryableFetchError') throw new Error('暂时无法读取登录状态，请重试。');
      user = JSON.parse(root.localStorage.getItem(storageKey));
      if (!user) throw new Error('首次登录需要联网。');
    } else if (user) root.localStorage.setItem(storageKey, JSON.stringify({ id: user.id, email: user.email }));
    else root.localStorage.removeItem(storageKey);
    const local = root.StudyStore;
    const report = (message) => root.dispatchEvent(new CustomEvent('study-cloud-status', { detail: message }));
    const account = user ? cachedAccount(local, createJournal(client, user.id, local.helpers.initialRecord, local.StoreError), `:account:${url.host}:${user.id}`, report) : null;
    const store = account?.store || local.createStore(root, null, ':guest');
    let migration;

    return {
      user,
      accountName: user?.email === OWNER_EMAIL ? OWNER_USERNAME : user?.email,
      store,
      sync: account?.sync,
      useCloud: account?.useCloud,
      migrateLocal() {
        if (user?.id !== ownerId) return;
        if (!migration) migration = account.migrated().then(async alreadyMigrated => {
          if (alreadyMigrated) return;
          const backup = await local.exportBackup();
          try { await store.importLocalOnce(backup); }
          catch (error) {
            if (error.status !== 409) throw error;
            await store.importLocalOnce(backup);
          }
        }).catch((error) => { migration = null; throw error; });
        return migration;
      },
      async signIn(identifier, password) {
        const email = identifier.toLowerCase() === OWNER_USERNAME ? OWNER_EMAIL : identifier;
        const { error: failure } = await client.auth.signInWithPassword({ email, password });
        if (failure) throw new Error(failure.code === 'invalid_credentials' ? '账号或密码有误，请重新输入。' : '登录未完成，请检查账号状态和网络后重试。');
      },
      async signOut() {
        const { error: failure } = await client.auth.signOut({ scope: 'local' });
        if (failure) throw new Error('退出未完成，请检查网络后重试。');
      },
      onAccountChange(callback) {
        client.auth.onAuthStateChange((event, session) => {
          if (event === 'INITIAL_SESSION' && error && !session) return;
          if (event === 'SIGNED_OUT') root.localStorage.removeItem(storageKey);
          if ((session?.user?.id || null) !== (user?.id || null)) root.setTimeout(callback, 0);
        });
      },
      watch(callback) {
        const refresh = () => account.sync().then(({ revision }) => { if (revision) callback(revision); }).catch(() => {});
        const channel = client.channel(`study-journal:${user.id}`);
        for (const event of ['INSERT', 'UPDATE']) {
          channel.on('postgres_changes', { event, schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` }, refresh);
        }
        channel.subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
      },
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createJournal };
  else root.StudyCloud = { configured, connect };
})(globalThis);
