# Supabase setup

1. Open the Supabase project dashboard, go to **SQL Editor**, paste the contents of `schema.sql`, and run it. This creates the portal tables, row-level security policies, and the private `portal-files` storage bucket.
2. In **Authentication → Providers → Email**, disable Supabase email confirmation. Student email ownership is checked using the portal's EmailJS OTP step.
3. In EmailJS **Account → Security**, allow the published origin `https://warlock247.github.io`. Test signup using the published HTTPS site or a local HTTP server, not by opening the `.html` file directly. A `file://` page has no browser origin and EmailJS rejects it. Do not enable non-browser API access just to test a local file.
4. In **Authentication → Users**, create or update the lecturer Auth user with email `lecturer@warlock247.github.io`, password `lecturer2026`, and mark the email as confirmed. This email is an internal Supabase Auth identifier only; it is not requested on the login form.
5. Promote that user by running this in **SQL Editor**:

   ```sql
   update public.profiles
   set role = 'lecturer'
   where lower(email) = 'lecturer@warlock247.github.io';
   ```

6. Push the updated project files and confirm the GitHub Pages deployment finishes. New student accounts are stored online in Supabase. Old browser-local data is not imported automatically.

The Supabase publishable key and internal lecturer Auth identifier in `supabase-config.js` are used by the browser. Never put a Supabase service-role key or database password in the website. The lecturer form asks only for the password; Supabase still authenticates the fixed internal account and applies lecturer-only row-level security.

Student Supabase passwords are the exact surname entered at registration (case-sensitive). Supabase requires passwords to be at least six characters, so this portal cannot register a shorter surname as the password. Surnames and the shared lecturer passcode are weak credentials; anyone who learns `lecturer2026` can access the lecturer dashboard.

EmailJS OTP sending requires the deployed origin to be allowed in EmailJS **Account → Security**. Ensure the EmailJS template uses `{{to_email}}`, `{{otp_code}}`, and `{{to_name}}`, and the configured service is active. The OTP check currently runs in the browser, so it is not a server-enforced identity check. For official records, validate matric numbers against a trusted roster and move verification into a trusted server function.
