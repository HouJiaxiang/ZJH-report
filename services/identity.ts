import { supabase } from '../lib/supabase';

let pending: Promise<string> | null = null;

// No login screen: Supabase persists and refreshes this anonymous session locally.
export const ensureIdentity = (): Promise<string> => {
  if (pending) return pending;
  pending = (async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error('暂时无法读取本机身份，请检查网络后重试');
    if (data.session) return data.session.user.id;
    const result = await supabase.auth.signInAnonymously();
    if (result.error || !result.data.user) {
      const code = result.error?.code;
      if (code === 'anonymous_provider_disabled') throw new Error('服务尚未启用匿名访客，请联系房主');
      if (result.error?.status === 429) throw new Error('当前网络访客请求较多，请稍后再试');
      throw new Error('暂时无法建立访客连接，请检查网络后重试');
    }
    return result.data.user.id;
  })().finally(() => { pending = null; });
  return pending;
};
