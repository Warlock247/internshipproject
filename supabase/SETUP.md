# Supabase Setup (Clean Start)

Follow these steps **in order** to set up a fresh Supabase backend.

---

## Step 1: Delete all existing Auth users

1. Open your Supabase project dashboard: `https://supabase.com/dashboard`
2. Go to **Authentication** → **Users**
3. Delete **every user** listed there (select all → delete)

## Step 2: Enable Email Provider

1. Go to **Authentication** → **Providers** → **Email**
2. Make sure **"Enable Email provider"** is **ON**
3. Turn **OFF** "Confirm email" (disable email confirmation)
4. Click **Save**

## Step 3: Run the database schema

1. Go to **SQL Editor**
2. Paste the **entire** contents of `schema.sql` and click **Run**
3. This drops all old tables/policies and creates everything fresh

## Step 4: Create the lecturer Auth user

1. Go to **Authentication** → **Users** → **Add user** → **Create new user**
2. Enter:
   - **Email:** `lecturer@portal.siwes.internal`
   - **Password:** `lecturer2026`
   - Check ✅ **Auto Confirm User**
3. Click **Create user**

## Step 5: Promote the lecturer profile

1. Go to **SQL Editor** and run:

   ```sql
   update public.profiles
   set role = 'lecturer'
   where id = (
     select id from auth.users
     where lower(email) = 'lecturer@portal.siwes.internal'
     limit 1
   );
   ```

## Step 6: Deploy

Push the updated project files to GitHub and confirm the GitHub Pages deployment finishes.

---

## How it works

- **Students** sign up with matric number, surname, first name, and email. Their password is their surname (lowercased, padded to 6 characters if short). All data is saved to Supabase PostgreSQL.
- **Lecturer** logs in with just the passcode `lecturer2026`. No email is shown on the form — the internal email `lecturer@portal.siwes.internal` is used behind the scenes.
- **Cross-device persistence**: Data is stored in Supabase's cloud database, so logging in on any device shows the same data.
- **EmailJS OTP** is used to verify student emails during sign-up. Make sure your deployed origin is allowed in EmailJS Account → Security.
