import { createClient } from '@supabase/supabase-js';

// ====================================================================================
// ⚙️ 数据库配置指南
// 1. 访问 https://supabase.com/dashboard/project/_/settings/api
// 2. 复制 "Project URL" 填入下方的 SUPABASE_URL
// 3. 复制 "anon public" Key 填入下方的 SUPABASE_ANON_KEY
// ====================================================================================

// 在此处粘贴你的 URL (保留单引号)
const SUPABASE_URL: string = 'https://mqhsjvhybslpofgyneol.supabase.co';

// 在此处粘贴你的 anon key (保留单引号)
const SUPABASE_ANON_KEY: string = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xaHNqdmh5YnNscG9mZ3luZW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTk3ODAsImV4cCI6MjA4NjQzNTc4MH0.ySWCkkkSXoxvlySCU7EfesPgqNi4e7okcOEvATz_ZTI';

// 检查是否已配置
export const isConfigured = 
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' && 
  !SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';

if (!isConfigured) {
  console.warn('⚠️ Supabase 尚未配置。应用将无法连接云端数据库。');
}

// 只有在配置后才尝试创建客户端，否则创建空客户端防止报错（虽然 UI 会拦截）
export const supabase = isConfigured 
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
  : createClient('https://placeholder.supabase.co', 'placeholder');