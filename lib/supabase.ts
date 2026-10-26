import { createClient } from '@supabase/supabase-js';

// ====================================================================================
// ⚙️ 数据库配置
// ====================================================================================

// Supabase API URL
const SUPABASE_URL: string = 'https://mqhsjvhybslpofgyneol.supabase.co';

// Supabase Anon Key
const SUPABASE_ANON_KEY: string = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xaHNqdmh5YnNscG9mZ3luZW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTk3ODAsImV4cCI6MjA4NjQzNTc4MH0.ySWCkkkSXoxvlySCU7EfesPgqNi4e7okcOEvATz_ZTI';

// 检查是否已配置
export const isConfigured = 
  !!SUPABASE_URL && 
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' && 
  !!SUPABASE_ANON_KEY &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';

if (!isConfigured) {
  console.warn('⚠️ Supabase 尚未配置。应用将无法连接云端数据库。');
}

// 创建客户端
// 注意: 这里移除了占位符客户端的逻辑，未配置时直接抛出清晰的错误，避免静默失败
export const supabase = isConfigured 
  ? createClient(import.meta.env?.VITE_SUPABASE_URL || SUPABASE_URL, import.meta.env?.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY, {
      global: {
        fetch: async (input, init) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          const abort = () => controller.abort();
          if (init?.signal?.aborted) controller.abort();
          init?.signal?.addEventListener('abort', abort, { once: true });
          try { return await fetch(input, { ...init, signal: controller.signal }); }
          finally { clearTimeout(timer); init?.signal?.removeEventListener('abort', abort); }
        },
      },
    })
  : null!; // 如果未配置，让它在使用时报错，而不是静默失败
