import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  "https://vsdlmymzrerhmitbjyki.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzZGxteW16cmVyaG1pdGJqeWtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzYyMjUsImV4cCI6MjA5Mzc1MjIyNX0.ZSrxLbeb5-p8tXIv4K9CNwQlAk3V3YAPqPxe_MoZoOc"
);
