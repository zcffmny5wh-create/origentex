import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = https://vsdlmymzrerhmitbjyki.supabase.co;
const SUPABASE_ANON_KEY = sb_publishable_Apx9E9igcwBFui9z2_0HHA_vQbaY_oi;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);