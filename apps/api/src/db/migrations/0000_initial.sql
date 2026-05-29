CREATE TYPE "public"."app_role" AS ENUM('admin', 'accounting', 'support');--> statement-breakpoint
CREATE TYPE "public"."chat_attachment_status" AS ENUM('uploaded', 'scanning', 'clean', 'infected', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."chat_category" AS ENUM('topup_issue', 'withdraw_issue', 'profile_update', 'general');--> statement-breakpoint
CREATE TYPE "public"."chat_pcr_field" AS ENUM('first_name', 'last_name', 'email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."chat_pcr_status" AS ENUM('pending', 'approved', 'rejected', 'applied');--> statement-breakpoint
CREATE TYPE "public"."chat_sender_role" AS ENUM('member', 'bot', 'staff');--> statement-breakpoint
CREATE TYPE "public"."chat_thread_status" AS ENUM('open', 'pending_staff', 'pending_user', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."code_status" AS ENUM('active', 'consumed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('none', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."merchant_type" AS ENUM('finance', 'commerce');--> statement-breakpoint
CREATE TYPE "public"."topup_status" AS ENUM('pending', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'completed', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('topup', 'spend', 'refund', 'adjustment', 'bonus', 'merchant_deposit', 'merchant_withdraw', 'merchant_credit', 'referral_bonus', 'affiliate_commission', 'affiliate_payout', 'profit_share');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_change_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"new_value" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"kyc_status" "kyc_status" DEFAULT 'none' NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"member_no" text NOT NULL,
	"referral_code" text,
	"signup_ip" "inet",
	"signup_ua" text,
	"signup_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_member_no_unique" UNIQUE("member_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"aal" text DEFAULT 'aal1' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_login_ips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip_address" "inet" NOT NULL,
	"user_agent" text,
	"country" text,
	"country_code" text,
	"city" text,
	"region" text,
	"device_type" text,
	"browser" text,
	"browser_version" text,
	"os" text,
	"os_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"friendly_name" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_role_unique" UNIQUE("user_id","role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_special_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"month" smallint NOT NULL,
	"day" smallint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reserved_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"current_tier_id" integer,
	"cooldown_until" timestamp with time zone,
	"cooldown_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_balance_nonneg" CHECK ("accounts"."balance" >= 0),
	CONSTRAINT "accounts_reserved_nonneg" CHECK ("accounts"."reserved_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "code_status" DEFAULT 'active' NOT NULL,
	"customer_name_snapshot" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"consumed_by_merchant" uuid,
	"reserved_spend_points" integer DEFAULT 0 NOT NULL,
	"reserved_cashback_points" integer DEFAULT 0 NOT NULL,
	"reserved_at_tier_id" integer,
	"reserved_at_turnover" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_points_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"reference_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"level_name" text NOT NULL,
	"display_name" text NOT NULL,
	"sub_rank" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"min_points" integer DEFAULT 0 NOT NULL,
	"min_turnover" numeric(14, 2) DEFAULT '0' NOT NULL,
	"commission_discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"point_multiplier" numeric(5, 2) DEFAULT '1' NOT NULL,
	"cashback_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_method_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label_tr" text NOT NULL,
	"label_en" text NOT NULL,
	"available_for" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description_tr" text,
	"description_en" text,
	"withdraw_eta_min" integer DEFAULT 5 NOT NULL,
	"withdraw_eta_max" integer DEFAULT 30 NOT NULL,
	"withdraw_eta_unit" text DEFAULT 'minute' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pmt_avail_chk" CHECK ("payment_method_types"."available_for" IN ('topup','withdraw','both')),
	CONSTRAINT "pmt_eta_unit_chk" CHECK ("payment_method_types"."withdraw_eta_unit" IN ('minute','hour','business_day'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"fixed_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"min_amount" numeric(14, 2),
	"max_amount" numeric(14, 2),
	"daily_limit" numeric(14, 2),
	"per_tx_limit" numeric(14, 2),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_provider_code_unique" UNIQUE("provider_id","code"),
	CONSTRAINT "payment_methods_kind_chk" CHECK ("payment_methods"."kind" IN ('topup','withdraw','both'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"fixed_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"per_tx_limit" numeric(14, 2),
	"daily_limit" numeric(14, 2),
	"min_amount" numeric(14, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_method_health" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider_method_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"timeout_count" integer DEFAULT 0 NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"avg_duration_ms" integer,
	"p95_duration_ms" integer,
	"success_rate" numeric(5, 4),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_method_health_window_unique" UNIQUE("provider_method_id","window_start","window_end")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_api_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"ip" text,
	"request_body" jsonb,
	"response_body" jsonb,
	"status_code" integer,
	"error_code" text,
	"latency_ms" integer,
	"merchant_ref" text,
	"request_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"trade_name" text,
	"tax_no" text NOT NULL,
	"tax_office" text,
	"address_line" text,
	"city" text,
	"country" text,
	"contact_email" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text,
	"requested_type" text NOT NULL,
	"requested_methods" text[],
	"iban" text,
	"iban_holder" text,
	"documents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"approved_merchant_id" uuid,
	"reviewed_by" uuid,
	"applicant_user_id" uuid,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_cash_pool_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"change_amount" numeric(14, 2) NOT NULL,
	"balance_before" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"notes" text,
	"note" text,
	"collection_fee_pct" numeric(5, 2),
	"collection_fixed_fee" numeric(10, 2),
	"collection_fee_amount" numeric(14, 2),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_cashout_methods" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"network" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"min_amount" numeric(14, 2),
	"max_amount" numeric(14, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_cashout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_no" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"method_code" text NOT NULL,
	"requested_by" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payout_address" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"external_tx_id" text,
	"failure_reason" text,
	"callback_payload" jsonb,
	"callback_received_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"merchant_ref" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_idempotency_unique" UNIQUE("merchant_id","endpoint","merchant_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deposit_commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"deposit_fixed_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"withdraw_commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"withdraw_fixed_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"min_amount" numeric(14, 2),
	"max_amount" numeric(14, 2),
	"per_tx_limit" numeric(14, 2),
	"daily_limit" numeric(14, 2),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_methods_merchant_code_unique" UNIQUE("merchant_id","code"),
	CONSTRAINT "merchant_methods_kind_chk" CHECK ("merchant_methods"."kind" IN ('deposit','withdraw','both'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_settlement_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"change_amount" numeric(14, 2) NOT NULL,
	"balance_before" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_user_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"is_allowed" boolean NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "muperm_user_key_unique" UNIQUE("merchant_user_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"full_name" text,
	"phone" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_users_user_merchant_unique" UNIQUE("user_id","merchant_id"),
	CONSTRAINT "merchant_users_role_chk" CHECK ("merchant_users"."role" IN ('owner','accountant','read_only'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"api_key" text NOT NULL,
	"api_secret_hash" text NOT NULL,
	"ip_whitelist" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"merchant_type" "merchant_type" NOT NULL,
	"commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"fixed_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"commission_direction" text DEFAULT 'merchant' NOT NULL,
	"deposit_commission_pct" numeric(5, 2),
	"deposit_fixed_fee" numeric(10, 2),
	"withdraw_commission_pct" numeric(5, 2),
	"withdraw_fixed_fee" numeric(10, 2),
	"daily_limit" numeric(14, 2),
	"per_tx_limit" numeric(14, 2),
	"deposit_min_amount" numeric(14, 2),
	"deposit_max_amount" numeric(14, 2),
	"withdraw_min_amount" numeric(14, 2),
	"withdraw_max_amount" numeric(14, 2),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit_limit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cash_pool" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cash_pool_updated_at" timestamp with time zone,
	"cash_pool_api_url" text,
	"cash_pool_api_method" text,
	"cash_pool_jq_path" text,
	"overdraft_enabled" boolean DEFAULT false NOT NULL,
	"overdraft_limit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"avg_withdraw_seconds" integer,
	"last_failure_at" timestamp with time zone,
	"failure_rate_pct" numeric(5, 2),
	"parent_merchant_id" uuid,
	"merchant_scope" text DEFAULT 'standalone' NOT NULL,
	"external_sub_merchant_ref" text,
	"organization_id" uuid,
	"signing_secret" text,
	"signing_secret_set_at" timestamp with time zone,
	"webhook_url" text,
	"webhook_url_set_at" timestamp with time zone,
	"topup_init_url" text,
	"integration_adapter" text,
	"cashout_commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cashout_fixed_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cashout_reserved_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"finance_collection_fee_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"finance_collection_fixed_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "merchants_balance_within_credit" CHECK ("merchants"."balance" >= -"merchants"."credit_limit"),
	CONSTRAINT "merchants_scope_chk" CHECK ("merchants"."merchant_scope" IN ('standalone','parent','child')),
	CONSTRAINT "merchants_commission_direction_chk" CHECK ("merchants"."commission_direction" IN ('merchant','member','split'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_method_id" uuid NOT NULL,
	"merchant_method_id" uuid,
	"user_id" uuid,
	"transaction_id" uuid,
	"topup_request_id" uuid,
	"direction" text NOT NULL,
	"amount_gross" numeric(14, 2) NOT NULL,
	"provider_commission" numeric(14, 2) DEFAULT '0' NOT NULL,
	"our_commission" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount_net" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_ref" text,
	"internal_ref" text,
	"api_request_at" timestamp with time zone,
	"api_response_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"raw_response" jsonb,
	"error_code" text,
	"error_message" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_method_id" uuid,
	"merchant_id" uuid,
	"gross_amount" numeric(14, 2) NOT NULL,
	"provider_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"status" "topup_status" DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"callback_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_no" text NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "tx_type" NOT NULL,
	"status" "tx_status" DEFAULT 'completed' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"balance_after" numeric(14, 2),
	"description" text,
	"reference_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_method_id" uuid,
	"merchant_method_id" uuid,
	"merchant_ref" text,
	"external_tx_id" text,
	"merchant_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdraw_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method_type" text NOT NULL,
	"direction" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"weight_pct" numeric(5, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_routing_rules_unique" UNIQUE("method_type","direction","merchant_id"),
	CONSTRAINT "payment_routing_direction_chk" CHECK ("payment_routing_rules"."direction" IN ('topup','withdraw'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topup_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_no" text NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"method_type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"merchant_ref" text,
	"redirect_url" text,
	"return_url" text,
	"iban" text,
	"account_holder" text,
	"bank_name" text,
	"payment_reference" text,
	"member_confirmed_at" timestamp with time zone,
	"callback_received_at" timestamp with time zone,
	"callback_payload" jsonb,
	"finalized_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"topup_request_id" uuid,
	"merchant_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topup_sessions_status_chk" CHECK ("topup_sessions"."status" IN ('pending','awaiting_member_action','member_confirmed','redirected','success','failed','expired','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdraw_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_no" text NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"method_type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"iban" text,
	"iban_holder" text,
	"crypto_type" text,
	"payout_address" text,
	"reserved_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"withdraw_request_id" uuid,
	"transaction_id" uuid,
	"merchant_ref" text,
	"external_tx_id" text,
	"push_request_payload" jsonb,
	"callback_payload" jsonb,
	"callback_received_at" timestamp with time zone,
	"push_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"failure_reason" text,
	"beneficiary_masked" text,
	"merchant_note" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdraw_sessions_status_chk" CHECK ("withdraw_sessions"."status" IN ('pending','sent_to_merchant','success','failed','timeout','expired','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_config" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"referrer_points" integer DEFAULT 0 NOT NULL,
	"referrer_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"referee_points" integer DEFAULT 0 NOT NULL,
	"referee_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"qualifying_spend_min" numeric(14, 2) DEFAULT '0' NOT NULL,
	"expire_after_days" integer DEFAULT 90 NOT NULL,
	"monthly_cap_per_referrer" integer DEFAULT 0 NOT NULL,
	"ip_cap_per_day" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_rewards_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"balance_awarded" numeric(14, 2) DEFAULT '0' NOT NULL,
	"transaction_id" uuid,
	"reference_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referee_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"qualifying_event" text,
	"qualifying_amount" numeric(14, 2),
	"qualified_at" timestamp with time zone,
	"rewarded_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referee_unique" UNIQUE("referee_user_id"),
	CONSTRAINT "referrals_no_self_chk" CHECK ("referrals"."referrer_user_id" <> "referrals"."referee_user_id"),
	CONSTRAINT "referrals_status_chk" CHECK ("referrals"."status" IN ('pending','qualified','rewarded','expired','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_affiliate_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"link_id" uuid,
	"transaction_id" uuid,
	"direction" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reference_id" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_affiliate_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"commission_basis" text NOT NULL,
	"commission_pct" numeric(5, 2),
	"fixed_amount_per_tx" numeric(14, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_affiliate_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"rejected_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"transfer_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"linked_user_id" uuid,
	"auth_user_id" uuid,
	"tax_id" text,
	"iban" text,
	"status" text DEFAULT 'active' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_affiliates_kind_chk" CHECK ("merchant_affiliates"."kind" IN ('external','internal_member')),
	CONSTRAINT "merchant_affiliates_status_chk" CHECK ("merchant_affiliates"."status" IN ('active','paused','terminated'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profit_share_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rank_no" integer NOT NULL,
	"turnover_amount" numeric(14, 2) NOT NULL,
	"share_pct" numeric(8, 5) NOT NULL,
	"allocated_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_tx_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"expired_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ps_alloc_campaign_user_unique" UNIQUE("campaign_id","user_id"),
	CONSTRAINT "ps_alloc_status_chk" CHECK ("profit_share_allocations"."status" IN ('pending','claimed','expired'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profit_share_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_type" text NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"distribution_pct" numeric(5, 2) NOT NULL,
	"platform_revenue" numeric(14, 2) NOT NULL,
	"platform_cost" numeric(14, 2) NOT NULL,
	"affiliate_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_profit" numeric(14, 2) NOT NULL,
	"pool_amount" numeric(14, 2) NOT NULL,
	"top_turnover_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"max_recipients" integer NOT NULL,
	"claim_expires_hours" integer DEFAULT 168 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ps_status_chk" CHECK ("profit_share_campaigns"."status" IN ('draft','published','closed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid,
	"uploader_user_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"status" "chat_attachment_status" DEFAULT 'uploaded' NOT NULL,
	"scan_result" jsonb,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_canned_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "chat_category" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"trigger_keywords" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_role" "chat_sender_role" NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"canned_response_id" uuid,
	"feedback_score" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_profile_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"field" "chat_pcr_field" NOT NULL,
	"new_value" text NOT NULL,
	"status" "chat_pcr_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_routing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "chat_category" NOT NULL,
	"tg_channel_ref" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_routing_rules_category_unique" UNIQUE("category")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_no" text NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "chat_category" DEFAULT 'general' NOT NULL,
	"subject" text NOT NULL,
	"status" "chat_thread_status" DEFAULT 'open' NOT NULL,
	"related_tx_public_no" text,
	"claimed_by_staff_id" uuid,
	"claimed_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"channel" text NOT NULL,
	"template_key" text NOT NULL,
	"locale" text DEFAULT 'tr' NOT NULL,
	"to_address" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "help_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_key" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text,
	"audience" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_templates_key_locale_unique" UNIQUE("template_key","locale")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"categories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title_tr" text NOT NULL,
	"body_tr" text NOT NULL,
	"title_en" text,
	"body_en" text,
	"link_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"audience_user_id" uuid,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"locale" text NOT NULL,
	"body_md" text NOT NULL,
	"audience" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tg_templates_key_locale_unique" UNIQUE("template_key","locale")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bo_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "app_role" NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bo_permissions_unique" UNIQUE("role","resource","action")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"granted" boolean NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permission_overrides_unique" UNIQUE("user_id","resource","action")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_tx_daily" (
	"day" timestamp NOT NULL,
	"type" text NOT NULL,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"total_amount" jsonb NOT NULL,
	"total_fee" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "error_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"surface" text NOT NULL,
	"page_key" text,
	"function_name" text,
	"error_code" text NOT NULL,
	"error_message" text NOT NULL,
	"stack" text,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"level" text DEFAULT 'info' NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_special_days" ADD CONSTRAINT "user_special_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_current_tier_id_loyalty_tiers_id_fk" FOREIGN KEY ("current_tier_id") REFERENCES "public"."loyalty_tiers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_codes" ADD CONSTRAINT "payment_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_codes" ADD CONSTRAINT "payment_codes_reserved_at_tier_id_loyalty_tiers_id_fk" FOREIGN KEY ("reserved_at_tier_id") REFERENCES "public"."loyalty_tiers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loyalty_points_log" ADD CONSTRAINT "loyalty_points_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_provider_id_payment_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_method_health" ADD CONSTRAINT "provider_method_health_provider_method_id_payment_methods_id_fk" FOREIGN KEY ("provider_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_api_calls" ADD CONSTRAINT "merchant_api_calls_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_approved_merchant_id_merchants_id_fk" FOREIGN KEY ("approved_merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_applications" ADD CONSTRAINT "merchant_applications_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_cash_pool_log" ADD CONSTRAINT "merchant_cash_pool_log_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_cash_pool_log" ADD CONSTRAINT "merchant_cash_pool_log_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_cashout_sessions" ADD CONSTRAINT "merchant_cashout_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_cashout_sessions" ADD CONSTRAINT "merchant_cashout_sessions_method_code_merchant_cashout_methods_code_fk" FOREIGN KEY ("method_code") REFERENCES "public"."merchant_cashout_methods"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_cashout_sessions" ADD CONSTRAINT "merchant_cashout_sessions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_idempotency" ADD CONSTRAINT "merchant_idempotency_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_methods" ADD CONSTRAINT "merchant_methods_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_settlement_log" ADD CONSTRAINT "merchant_settlement_log_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_settlement_log" ADD CONSTRAINT "merchant_settlement_log_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_user_permission_overrides" ADD CONSTRAINT "merchant_user_permission_overrides_merchant_user_id_merchant_users_id_fk" FOREIGN KEY ("merchant_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_user_permission_overrides" ADD CONSTRAINT "merchant_user_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchants" ADD CONSTRAINT "merchants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchants" ADD CONSTRAINT "merchants_parent_merchant_id_merchants_id_fk" FOREIGN KEY ("parent_merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_ledger" ADD CONSTRAINT "provider_ledger_provider_method_id_payment_methods_id_fk" FOREIGN KEY ("provider_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_ledger" ADD CONSTRAINT "provider_ledger_merchant_method_id_merchant_methods_id_fk" FOREIGN KEY ("merchant_method_id") REFERENCES "public"."merchant_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_ledger" ADD CONSTRAINT "provider_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_ledger" ADD CONSTRAINT "provider_ledger_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_ledger" ADD CONSTRAINT "provider_ledger_topup_request_id_topup_requests_id_fk" FOREIGN KEY ("topup_request_id") REFERENCES "public"."topup_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_ledger" ADD CONSTRAINT "provider_ledger_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_requests" ADD CONSTRAINT "topup_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_requests" ADD CONSTRAINT "topup_requests_provider_method_id_payment_methods_id_fk" FOREIGN KEY ("provider_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_requests" ADD CONSTRAINT "topup_requests_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_provider_method_id_payment_methods_id_fk" FOREIGN KEY ("provider_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_method_id_merchant_methods_id_fk" FOREIGN KEY ("merchant_method_id") REFERENCES "public"."merchant_methods"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdraw_requests" ADD CONSTRAINT "withdraw_requests_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_routing_rules" ADD CONSTRAINT "payment_routing_rules_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_sessions" ADD CONSTRAINT "topup_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_sessions" ADD CONSTRAINT "topup_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topup_sessions" ADD CONSTRAINT "topup_sessions_topup_request_id_topup_requests_id_fk" FOREIGN KEY ("topup_request_id") REFERENCES "public"."topup_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdraw_sessions" ADD CONSTRAINT "withdraw_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdraw_sessions" ADD CONSTRAINT "withdraw_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdraw_sessions" ADD CONSTRAINT "withdraw_sessions_withdraw_request_id_withdraw_requests_id_fk" FOREIGN KEY ("withdraw_request_id") REFERENCES "public"."withdraw_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "withdraw_sessions" ADD CONSTRAINT "withdraw_sessions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_config" ADD CONSTRAINT "referral_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_rewards_log" ADD CONSTRAINT "referral_rewards_log_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_rewards_log" ADD CONSTRAINT "referral_rewards_log_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_rewards_log" ADD CONSTRAINT "referral_rewards_log_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_user_id_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_ledger" ADD CONSTRAINT "merchant_affiliate_ledger_affiliate_id_merchant_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."merchant_affiliates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_ledger" ADD CONSTRAINT "merchant_affiliate_ledger_link_id_merchant_affiliate_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."merchant_affiliate_links"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_ledger" ADD CONSTRAINT "merchant_affiliate_ledger_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_links" ADD CONSTRAINT "merchant_affiliate_links_affiliate_id_merchant_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."merchant_affiliates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_links" ADD CONSTRAINT "merchant_affiliate_links_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_links" ADD CONSTRAINT "merchant_affiliate_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_payouts" ADD CONSTRAINT "merchant_affiliate_payouts_affiliate_id_merchant_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."merchant_affiliates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliate_payouts" ADD CONSTRAINT "merchant_affiliate_payouts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliates" ADD CONSTRAINT "merchant_affiliates_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliates" ADD CONSTRAINT "merchant_affiliates_auth_user_id_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_affiliates" ADD CONSTRAINT "merchant_affiliates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_share_allocations" ADD CONSTRAINT "profit_share_allocations_campaign_id_profit_share_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."profit_share_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_share_allocations" ADD CONSTRAINT "profit_share_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_share_allocations" ADD CONSTRAINT "profit_share_allocations_claim_tx_id_transactions_id_fk" FOREIGN KEY ("claim_tx_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_share_campaigns" ADD CONSTRAINT "profit_share_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_share_campaigns" ADD CONSTRAINT "profit_share_campaigns_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profit_share_campaigns" ADD CONSTRAINT "profit_share_campaigns_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_profile_change_requests" ADD CONSTRAINT "chat_profile_change_requests_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_profile_change_requests" ADD CONSTRAINT "chat_profile_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_profile_change_requests" ADD CONSTRAINT "chat_profile_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_claimed_by_staff_id_users_id_fk" FOREIGN KEY ("claimed_by_staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_audience_user_id_users_id_fk" FOREIGN KEY ("audience_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_templates" ADD CONSTRAINT "telegram_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "error_diagnostics" ADD CONSTRAINT "error_diagnostics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_hash_unique" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_email_unique_lower" ON "profiles" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_referral_code_unique" ON "profiles" USING btree ("referral_code") WHERE "profiles"."referral_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_phone_unique" ON "profiles" USING btree ("phone") WHERE "profiles"."phone" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_hash_unique" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_login_ips_user_created_idx" ON "user_login_ips" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_mfa_factors_user_idx" ON "user_mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique_lower" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_cooldown_idx" ON "accounts" USING btree ("cooldown_until") WHERE "accounts"."cooldown_until" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_codes_code_active_unique" ON "payment_codes" USING btree ("code") WHERE "payment_codes"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_codes_code_global_unique" ON "payment_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_codes_user_status_exp_idx" ON "payment_codes" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_points_log_user_idx" ON "loyalty_points_log" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_rules_key_unique" ON "loyalty_rules" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_providers_code_unique" ON "payment_providers" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_method_health_method_idx" ON "provider_method_health" USING btree ("provider_method_id","window_start" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_api_calls_merchant_idx" ON "merchant_api_calls" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_api_calls_created_idx" ON "merchant_api_calls" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_apps_email_pending_unique" ON "merchant_applications" USING btree (lower("contact_email")) WHERE "merchant_applications"."status" IN ('pending','reviewing','info_requested');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_cashout_sessions_public_no_unique" ON "merchant_cashout_sessions" USING btree ("public_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_cashout_sessions_merchant_idx" ON "merchant_cashout_sessions" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_idempotency_expiry_idx" ON "merchant_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_users_email_unique_lower" ON "merchant_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_users_merchant_idx" ON "merchant_users" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchants_api_key_unique" ON "merchants" USING btree ("api_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchants_parent_idx" ON "merchants" USING btree ("parent_merchant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_ledger_provider_created_idx" ON "provider_ledger" USING btree ("provider_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_ledger_tx_idx" ON "provider_ledger" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topup_requests_merchant_ref_unique" ON "topup_requests" USING btree ("merchant_id","provider_ref") WHERE "topup_requests"."merchant_id" IS NOT NULL AND "topup_requests"."provider_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_public_no_unique" ON "transactions" USING btree ("public_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_created_idx" ON "transactions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_type_created_idx" ON "transactions" USING btree ("type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_metadata_merchant_idx" ON "transactions" USING btree (("metadata"->>'merchant_id'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_routing_lookup_idx" ON "payment_routing_rules" USING btree ("method_type","direction","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topup_sessions_public_no_unique" ON "topup_sessions" USING btree ("public_no");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topup_sessions_one_open_per_user_unique" ON "topup_sessions" USING btree ("user_id") WHERE "topup_sessions"."status" IN ('pending','awaiting_member_action','member_confirmed','redirected');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topup_sessions_status_exp_idx" ON "topup_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topup_sessions_merchant_idx" ON "topup_sessions" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "withdraw_sessions_public_no_unique" ON "withdraw_sessions" USING btree ("public_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdraw_sessions_status_exp_idx" ON "withdraw_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdraw_sessions_merchant_idx" ON "withdraw_sessions" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "referral_rewards_log_reference_unique" ON "referral_rewards_log" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_rewards_log_recipient_idx" ON "referral_rewards_log" USING btree ("recipient_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_affiliate_ledger_reference_unique" ON "merchant_affiliate_ledger" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_affiliate_ledger_aff_idx" ON "merchant_affiliate_ledger" USING btree ("affiliate_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "affiliate_links_aff_merch_idx" ON "merchant_affiliate_links" USING btree ("affiliate_id","merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_affiliates_code_unique" ON "merchant_affiliates" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ps_alloc_user_idx" ON "profit_share_allocations" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ps_status_idx" ON "profit_share_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_attachments_thread_idx" ON "chat_attachments" USING btree ("thread_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_pcr_user_idx" ON "chat_profile_change_requests" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_threads_public_no_unique" ON "chat_threads" USING btree ("public_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_user_idx" ON "chat_threads" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_status_idx" ON "chat_threads" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_outbox_pending_idx" ON "event_outbox" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "help_articles_page_locale_unique" ON "help_articles" USING btree ("page_key","locale");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suggestions_audience_idx" ON "suggestions" USING btree ("audience_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "error_diagnostics_created_idx" ON "error_diagnostics" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_runs_name_started_idx" ON "job_runs" USING btree ("job_name","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_runs_running_unique" ON "job_runs" USING btree ("job_name") WHERE "job_runs"."finished_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_logs_created_idx" ON "system_logs" USING btree ("created_at" DESC NULLS LAST);