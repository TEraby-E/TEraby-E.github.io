'use strict';

((root) => {
  const TABLE = 'study_journals';
  const FIELDS = 'revision,snapshot';
  const OWNER_USERNAME = 'terabyte';
  const OWNER_EMAIL = `${OWNER_USERNAME}@study.terabyte.top`;

  function createTransaction(client, userId, initialRecord, StoreError) {
    const journals = () => client.from(TABLE);
    const unavailable = () => new StoreError('云端记录暂时无法读写，请检查网络和 Supabase 配置后重试。', 503);
    const conflict = () => new StoreError('另一个窗口或设备已更新学习记录。', 409);
    const read = () => journals().select(FIELDS).eq('user_id', userId).maybeSingle();

    return async (operation) => {
      let { data, error } = await read();
      if (error) throw unavailable();
      if (!data) {
        const { revision, ...snapshot } = initialRecord();
        ({ data, error } = await journals().insert({ user_id: userId, revision, snapshot }).select(FIELDS).single());
        if (error?.code === '23505') ({ data, error } = await read());
        if (error || !data) throw unavailable();
      }

      const previous = { ...data.snapshot, revision: data.revision };
      const outcome = operation(previous);
      if (outcome.record) {
        const { revision, ...snapshot } = outcome.record;
        const write = await journals().update({ revision, snapshot }).eq('user_id', userId)
          .eq('revision', previous.revision).select('revision').maybeSingle();
        if (write.error) throw unavailable();
        if (!write.data) throw conflict();
      }
      return outcome.result;
    };
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
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error('暂时无法读取登录状态，请检查网络后重试。');
    const user = data.session?.user || null;
    const local = root.StudyStore;
    const store = user ? local.createStore(root, createTransaction(client, user.id, local.helpers.initialRecord, local.StoreError)) : local;
    let migration;

    return {
      user,
      accountName: user?.email === OWNER_EMAIL ? OWNER_USERNAME : user?.email,
      store,
      migrateLocal() {
        if (user?.id !== ownerId) return;
        if (!migration) migration = local.exportBackup().then(async (backup) => {
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
        client.auth.onAuthStateChange((_event, session) => {
          if ((session?.user?.id || null) !== (user?.id || null)) root.setTimeout(callback, 0);
        });
      },
      watch(callback) {
        const channel = client.channel(`study-journal:${user.id}`);
        for (const event of ['INSERT', 'UPDATE']) {
          channel.on('postgres_changes', { event, schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` }, (change) => callback(change.new?.revision));
        }
        channel.subscribe((status) => { if (status === 'SUBSCRIBED') callback(); });
      },
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createTransaction };
  else root.StudyCloud = { configured, connect };
})(globalThis);
