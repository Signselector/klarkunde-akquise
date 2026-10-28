export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      appointment_notifications: {
        Row: {
          appointment_id: string
          created_at: string
          id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          booked_by: string | null
          country: string
          created_at: string
          id: string
          kind: string
          lead_id: string | null
          notes: string | null
          pd_activity_id: number | null
          pd_sync_error: string | null
          pd_sync_state: string
          pd_synced_at: string | null
          starts_at: string
          title: string | null
          user_id: string | null
        }
        Insert: {
          booked_by?: string | null
          country?: string
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string | null
          notes?: string | null
          pd_activity_id?: number | null
          pd_sync_error?: string | null
          pd_sync_state?: string
          pd_synced_at?: string | null
          starts_at: string
          title?: string | null
          user_id?: string | null
        }
        Update: {
          booked_by?: string | null
          country?: string
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string | null
          notes?: string | null
          pd_activity_id?: number | null
          pd_sync_error?: string | null
          pd_sync_state?: string
          pd_synced_at?: string | null
          starts_at?: string
          title?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          id: string
          target_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          id?: string
          target_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          id?: string
          target_id?: string | null
        }
        Relationships: []
      }
      backups: {
        Row: {
          created_at: string
          data: Json
          id: string
          kind: string
          rows_total: number
          size_bytes: number
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          kind?: string
          rows_total?: number
          size_bytes?: number
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          kind?: string
          rows_total?: number
          size_bytes?: number
        }
        Relationships: []
      }
      call_requests: {
        Row: {
          payload: Json
          request_id: string
          result: Json
          user_id: string
        }
        Insert: {
          payload: Json
          request_id: string
          result: Json
          user_id: string
        }
        Update: {
          payload?: Json
          request_id?: string
          result?: Json
          user_id?: string
        }
        Relationships: []
      }
      callbacks: {
        Row: {
          country: string
          created_at: string
          done: boolean
          due_at: string
          id: string
          lead_id: string
          pd_activity_id: number | null
          pd_sync_error: string | null
          pd_sync_state: string
          pd_synced_at: string | null
          user_id: string | null
          version: number
        }
        Insert: {
          country?: string
          created_at?: string
          done?: boolean
          due_at: string
          id?: string
          lead_id: string
          pd_activity_id?: number | null
          pd_sync_error?: string | null
          pd_sync_state?: string
          pd_synced_at?: string | null
          user_id?: string | null
          version?: number
        }
        Update: {
          country?: string
          created_at?: string
          done?: boolean
          due_at?: string
          id?: string
          lead_id?: string
          pd_activity_id?: number | null
          pd_sync_error?: string | null
          pd_sync_state?: string
          pd_synced_at?: string | null
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "callbacks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      coins_ledger: {
        Row: {
          coins: number
          created_at: string
          id: string
          occurred_at: string
          reason: string
          source_id: string | null
          source_type: string
          user_id: string
        }
        Insert: {
          coins: number
          created_at?: string
          id?: string
          occurred_at?: string
          reason: string
          source_id?: string | null
          source_type: string
          user_id: string
        }
        Update: {
          coins?: number
          created_at?: string
          id?: string
          occurred_at?: string
          reason?: string
          source_id?: string | null
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coins_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          data: Json
          errors: string[]
          row_no: number
        }
        Insert: {
          batch_id: string
          data: Json
          errors: string[]
          row_no: number
        }
        Update: {
          batch_id?: string
          data?: Json
          errors?: string[]
          row_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "lead_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_config: {
        Row: {
          appointment_stage_id: number | null
          enabled: boolean
          id: boolean
          owner_id: number | null
          pipeline_id: number | null
          production_stage_id: number | null
          test_mode: boolean
        }
        Insert: {
          appointment_stage_id?: number | null
          enabled?: boolean
          id?: boolean
          owner_id?: number | null
          pipeline_id?: number | null
          production_stage_id?: number | null
          test_mode?: boolean
        }
        Update: {
          appointment_stage_id?: number | null
          enabled?: boolean
          id?: boolean
          owner_id?: number | null
          pipeline_id?: number | null
          production_stage_id?: number | null
          test_mode?: boolean
        }
        Relationships: []
      }
      integration_jobs: {
        Row: {
          attempts: number
          created_at: string
          error_code: string | null
          event_id: string
          id: string
          lead_id: string
          lease_token: string | null
          lease_until: string | null
          next_attempt_at: string
          outcome: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          event_id: string
          id?: string
          lead_id: string
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          outcome: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_code?: string | null
          event_id?: string
          id?: string
          lead_id?: string
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          outcome?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "status_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_actions: {
        Row: {
          action: string
          created_at: string
          crm_attempted_at: string | null
          crm_error: string | null
          crm_steps: Json
          crm_sync_state: string | null
          crm_synced_at: string | null
          details: Json | null
          id: string
          lead_id: string
          logo_path: string | null
          note: string | null
          scheduled_at: string | null
          stage_key: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          crm_attempted_at?: string | null
          crm_error?: string | null
          crm_steps?: Json
          crm_sync_state?: string | null
          crm_synced_at?: string | null
          details?: Json | null
          id?: string
          lead_id: string
          logo_path?: string | null
          note?: string | null
          scheduled_at?: string | null
          stage_key?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          crm_attempted_at?: string | null
          crm_error?: string | null
          crm_steps?: Json
          crm_sync_state?: string | null
          crm_synced_at?: string | null
          details?: Json | null
          id?: string
          lead_id?: string
          logo_path?: string | null
          note?: string | null
          scheduled_at?: string | null
          stage_key?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activity: {
        Row: {
          acting_user_id: string | null
          acting_user_name: string | null
          action_type: string
          created_at: string
          deal_id: number | null
          details: Json | null
          external_id: string | null
          id: string
          lead_id: string
          new_stage: string | null
          occurred_at: string
          origin_caller_id: string | null
          previous_stage: string | null
          seq: number
          source: string
        }
        Insert: {
          acting_user_id?: string | null
          acting_user_name?: string | null
          action_type: string
          created_at?: string
          deal_id?: number | null
          details?: Json | null
          external_id?: string | null
          id?: string
          lead_id: string
          new_stage?: string | null
          occurred_at?: string
          origin_caller_id?: string | null
          previous_stage?: string | null
          seq?: never
          source: string
        }
        Update: {
          acting_user_id?: string | null
          acting_user_name?: string | null
          action_type?: string
          created_at?: string
          deal_id?: number | null
          details?: Json | null
          external_id?: string | null
          id?: string
          lead_id?: string
          new_stage?: string | null
          occurred_at?: string
          origin_caller_id?: string | null
          previous_stage?: string | null
          seq?: never
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activity_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_batches: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          country: string
          created_at: string
          created_by: string | null
          id: string
          import_state: string
          name: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          import_state?: string
          name: string
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          import_state?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_batches_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_claims: {
        Row: {
          expires_at: string
          id: string
          lead_id: string
          user_id: string
        }
        Insert: {
          expires_at: string
          id?: string
          lead_id: string
          user_id: string
        }
        Update: {
          expires_at?: string
          id?: string
          lead_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_claims_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_crm_links: {
        Row: {
          country: string
          created_at: string
          current_stage_id: number | null
          current_stage_key: string | null
          deal_id: number | null
          deal_status: string | null
          is_customer: boolean
          last_synced_at: string | null
          lead_id: string
          organization_id: number | null
          origin_caller_id: string | null
          origin_lead_id: string | null
          person_id: number | null
          stage_event_at: string | null
          sync_state: string
          updated_at: string
        }
        Insert: {
          country: string
          created_at?: string
          current_stage_id?: number | null
          current_stage_key?: string | null
          deal_id?: number | null
          deal_status?: string | null
          is_customer?: boolean
          last_synced_at?: string | null
          lead_id: string
          organization_id?: number | null
          origin_caller_id?: string | null
          origin_lead_id?: string | null
          person_id?: number | null
          stage_event_at?: string | null
          sync_state?: string
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          current_stage_id?: number | null
          current_stage_key?: string | null
          deal_id?: number | null
          deal_status?: string | null
          is_customer?: boolean
          last_synced_at?: string | null
          lead_id?: string
          organization_id?: number | null
          origin_caller_id?: string | null
          origin_lead_id?: string | null
          person_id?: number | null
          stage_event_at?: string | null
          sync_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_crm_links_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_emails: {
        Row: {
          attempted_at: string | null
          attempts: number
          body: string
          created_at: string
          created_by: string
          error: string | null
          id: string
          kind: string
          lead_id: string
          provider: string | null
          provider_message_id: string | null
          replied_at: string | null
          request_id: string
          sent_at: string | null
          status: string
          subject: string
          template_id: string | null
          to_email: string
        }
        Insert: {
          attempted_at?: string | null
          attempts?: number
          body: string
          created_at?: string
          created_by: string
          error?: string | null
          id?: string
          kind: string
          lead_id: string
          provider?: string | null
          provider_message_id?: string | null
          replied_at?: string | null
          request_id: string
          sent_at?: string | null
          status?: string
          subject: string
          template_id?: string | null
          to_email: string
        }
        Update: {
          attempted_at?: string | null
          attempts?: number
          body?: string
          created_at?: string
          created_by?: string
          error?: string | null
          id?: string
          kind?: string
          lead_id?: string
          provider?: string | null
          provider_message_id?: string | null
          replied_at?: string | null
          request_id?: string
          sent_at?: string | null
          status?: string
          subject?: string
          template_id?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          lead_id: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          lead_id: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          lead_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          archived_at: string | null
          attempts: number
          batch_id: string | null
          city: string | null
          company: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          erased_at: string | null
          extra: Json
          id: string
          last_called_at: string | null
          last_called_by: string | null
          phone: string | null
          status: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          attempts?: number
          batch_id?: string | null
          city?: string | null
          company?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          erased_at?: string | null
          extra?: Json
          id?: string
          last_called_at?: string | null
          last_called_by?: string | null
          phone?: string | null
          status?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          attempts?: number
          batch_id?: string | null
          city?: string | null
          company?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          erased_at?: string | null
          extra?: Json
          id?: string
          last_called_at?: string | null
          last_called_by?: string | null
          phone?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "leads_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "lead_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_quality: {
        Row: {
          frozen_at: string
          high_q: number
          low_q: number
          month: string
          per_100: number | null
          processed: number
          qualified: number
          user_id: string
        }
        Insert: {
          frozen_at?: string
          high_q: number
          low_q: number
          month: string
          per_100?: number | null
          processed: number
          qualified: number
          user_id: string
        }
        Update: {
          frozen_at?: string
          high_q?: number
          low_q?: number
          month?: string
          per_100?: number | null
          processed?: number
          qualified?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_quality_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_customers: {
        Row: {
          address: string | null
          country: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      offer_items: {
        Row: {
          description: string
          id: string
          offer_id: string
          product_id: string | null
          quantity: number
          unit_price: number
        }
        Insert: {
          description: string
          id?: string
          offer_id: string
          product_id?: string | null
          quantity?: number
          unit_price?: number
        }
        Update: {
          description?: string
          id?: string
          offer_id?: string
          product_id?: string | null
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "offer_items_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "offer_products"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          unit_price?: number
        }
        Relationships: []
      }
      offers: {
        Row: {
          country: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          note: string | null
          offer_number: string
          status: string
          version: number
        }
        Insert: {
          country?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          note?: string | null
          offer_number: string
          status?: string
          version?: number
        }
        Update: {
          country?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          note?: string | null
          offer_number?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "offer_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_calendar_queue: {
        Row: {
          action: string
          activity_id: number
          country: string
          created_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          activity_id: number
          country: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          activity_id?: number
          country?: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      pipedrive_activities: {
        Row: {
          activity_id: number
          country: string
          deal_id: number | null
          done: boolean
          due_at: string
          duration_min: number
          note: string | null
          org_name: string | null
          person_name: string | null
          subject: string | null
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_id: number
          country: string
          deal_id?: number | null
          done?: boolean
          due_at: string
          duration_min?: number
          note?: string | null
          org_name?: string | null
          person_name?: string | null
          subject?: string | null
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_id?: number
          country?: string
          deal_id?: number | null
          done?: boolean
          due_at?: string
          duration_min?: number
          note?: string | null
          org_name?: string | null
          person_name?: string | null
          subject?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipedrive_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pipedrive_busy: {
        Row: {
          activity_id: number
          country: string
          ends_at: string
          starts_at: string
        }
        Insert: {
          activity_id: number
          country: string
          ends_at: string
          starts_at: string
        }
        Update: {
          activity_id?: number
          country?: string
          ends_at?: string
          starts_at?: string
        }
        Relationships: []
      }
      pipedrive_stage_mapping: {
        Row: {
          country: string
          mapping: Json
          updated_at: string
        }
        Insert: {
          country: string
          mapping?: Json
          updated_at?: string
        }
        Update: {
          country?: string
          mapping?: Json
          updated_at?: string
        }
        Relationships: []
      }
      pipedrive_stage_validation: {
        Row: {
          checked_at: string
          checked_by: string | null
          country: string
          ok: boolean
          origin_field_key: string | null
          report: Json
        }
        Insert: {
          checked_at?: string
          checked_by?: string | null
          country: string
          ok: boolean
          origin_field_key?: string | null
          report: Json
        }
        Update: {
          checked_at?: string
          checked_by?: string | null
          country?: string
          ok?: boolean
          origin_field_key?: string | null
          report?: Json
        }
        Relationships: []
      }
      pipedrive_user_map: {
        Row: {
          country: string
          matched_at: string
          pipedrive_user_id: number
          user_id: string
        }
        Insert: {
          country: string
          matched_at?: string
          pipedrive_user_id: number
          user_id: string
        }
        Update: {
          country?: string
          matched_at?: string
          pipedrive_user_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipedrive_user_map_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      points_ledger: {
        Row: {
          created_at: string
          id: string
          occurred_at: string
          points: number
          reason: string
          source_id: string | null
          source_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          occurred_at?: string
          points: number
          reason: string
          source_id?: string | null
          source_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          occurred_at?: string
          points?: number
          reason?: string
          source_id?: string | null
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "points_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      quality_resolutions: {
        Row: {
          kind: string
          lead_id: string
          reason: string
          resolved_at: string
          resolved_by: string
        }
        Insert: {
          kind: string
          lead_id: string
          reason: string
          resolved_at?: string
          resolved_by: string
        }
        Update: {
          kind?: string
          lead_id?: string
          reason?: string
          resolved_at?: string
          resolved_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_resolutions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      status_changes: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          new_status: string
          old_status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          new_status: string
          old_status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          new_status?: string
          old_status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_changes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      team_metrics: {
        Row: {
          lead_quality: number | null
          leads_contributed: number | null
          period: string
          synced_at: string
          user_id: string
        }
        Insert: {
          lead_quality?: number | null
          leads_contributed?: number | null
          period: string
          synced_at?: string
          user_id: string
        }
        Update: {
          lead_quality?: number | null
          leads_contributed?: number | null
          period?: string
          synced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_countries: {
        Row: {
          country: string
          user_id: string
        }
        Insert: {
          country: string
          user_id: string
        }
        Update: {
          country?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_countries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_ranking_snapshots: {
        Row: {
          frozen_at: string
          points: number
          rank: number
          user_id: string
          week_start: string
        }
        Insert: {
          frozen_at?: string
          points: number
          rank: number
          user_id: string
          week_start: string
        }
        Update: {
          frozen_at?: string
          points?: number
          rank?: number
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_ranking_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_quality: {
        Args: { p_kind: string; p_lead_id: string; p_reason: string }
        Returns: undefined
      }
      activate_future_projects: { Args: never; Returns: Json }
      archive_leads: { Args: { p_ids: string[] }; Returns: number }
      archive_open_leads: { Args: never; Returns: number }
      assign_appointment: {
        Args: { p_appointment_id: string; p_user_id: string }
        Returns: undefined
      }
      backend_maintenance: { Args: never; Returns: Json }
      cal_apply_activity: {
        Args: { p_a: Json; p_country: string; p_user: string }
        Returns: string
      }
      cal_prune: {
        Args: {
          p_country: string
          p_from: string
          p_keep: number[]
          p_to: string
          p_user: string
        }
        Returns: number
      }
      cal_replace_busy: {
        Args: { p_country: string; p_from: string; p_rows: Json; p_to: string }
        Returns: number
      }
      can_access_country: { Args: { _c: string }; Returns: boolean }
      checkpoint_integration: {
        Args: {
          p_external_id: number
          p_job_id: string
          p_kind: string
          p_lease_token: string
        }
        Returns: undefined
      }
      claim_batch: { Args: { p_batch_id: string }; Returns: Json }
      claim_integration_jobs: { Args: { p_limit?: number }; Returns: Json }
      claim_next_lead:
        | { Args: never; Returns: Json }
        | { Args: { p_country: string }; Returns: Json }
      complete_callback: {
        Args: {
          p_callback_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: Json
      }
      confirm_import: {
        Args: {
          p_allow_duplicates?: boolean
          p_batch_id: string
          p_request_id: string
          p_skip_rows?: number[]
        }
        Returns: Json
      }
      create_appointment: {
        Args: {
          p_lead_id?: string
          p_notes?: string
          p_request_id: string
          p_starts_at: string
        }
        Returns: Json
      }
      create_backup: { Args: { p_kind?: string }; Returns: string }
      crm_apply_stage: {
        Args: {
          p_actor?: string
          p_actor_name?: string
          p_country: string
          p_deal_id: number
          p_event_id: string
          p_occurred: string
          p_source: string
          p_stage_id: number
          p_stage_key?: string
          p_status?: string
        }
        Returns: Json
      }
      crm_save_links: {
        Args: {
          p_actor: string
          p_country: string
          p_deal: number
          p_lead: string
          p_org: number
          p_origin: string
          p_person: number
          p_stage_key: string
        }
        Returns: Json
      }
      crm_set_sync_state: {
        Args: { p_lead: string; p_state: string }
        Returns: undefined
      }
      delete_appointment: {
        Args: { p_appointment_id: string }
        Returns: undefined
      }
      finish_integration_job: {
        Args: {
          p_error_code?: string
          p_job_id: string
          p_lease_token: string
          p_retry_after?: number
          p_status: string
        }
        Returns: undefined
      }
      freeze_monthly_quality: { Args: { p_month?: string }; Returns: number }
      get_batch_crm_objects: { Args: { p_batch_id: string }; Returns: Json }
      get_batch_progress: { Args: never; Returns: Json }
      get_caller_day: { Args: { p_day?: string }; Returns: Json }
      get_caller_month: { Args: { p_month?: string }; Returns: Json }
      get_caller_performance: {
        Args: {
          p_from: string
          p_granularity?: string
          p_to: string
          p_user?: string
        }
        Returns: Json
      }
      get_capabilities: { Args: never; Returns: Json }
      get_completed_overview: {
        Args: { p_country: string; p_limit?: number }
        Returns: Json
      }
      set_import_batch_country: { Args: { p_batch_id: string; p_country: string }; Returns: undefined }
      get_country_period_stats: {
        Args: {
          p_bucket?: string
          p_country: string
          p_from: string
          p_to: string
          p_user_id?: string
        }
        Returns: Json
      }
      get_dashboard: {
        Args: { p_from: string; p_scope?: string; p_to: string }
        Returns: Json
      }
      get_future_projects_leads: { Args: { p_country: string }; Returns: Json }
      get_monthly_quality: { Args: { p_month?: string }; Returns: Json }
      get_my_customers: { Args: { p_country: string }; Returns: Json }
      get_no_interest_leads: { Args: { p_country: string }; Returns: Json }
      get_quality_issues: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_slot_availability: {
        Args: {
          p_country: string
          p_from: string
          p_kind: string
          p_lead?: string
          p_to: string
        }
        Returns: Json
      }
      get_team_metrics: { Args: never; Returns: Json }
      get_unanswered_reference_leads: {
        Args: { p_country: string }
        Returns: Json
      }
      get_weekly_ranking: { Args: { p_week?: string }; Returns: Json }
      has_admin_rights: {
        Args: { _country: string; _uid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_duplicates: { Args: { p_batch_id: string }; Returns: Json }
      is_global_admin: { Args: { _uid: string }; Returns: boolean }
      is_master: { Args: { _uid: string }; Returns: boolean }
      move_lead: {
        Args: {
          p_batch_id: string
          p_expected_version: number
          p_lead_id: string
        }
        Returns: undefined
      }
      my_countries: { Args: never; Returns: string[] }
      preview_import: {
        Args: {
          p_batch_id?: string
          p_name: string
          p_request_id: string
          p_rows: Json
        }
        Returns: Json
      }
      purge_test_batch: { Args: { p_batch_id: string }; Returns: Json }
      reassign_batch: {
        Args: { p_batch_id: string; p_user_id: string }
        Returns: Json
      }
      record_call_outcome: {
        Args: {
          p_callback_id?: string
          p_expected_attempts: number
          p_lead_id: string
          p_note?: string
          p_outcome: string
          p_request_id: string
          p_scheduled_at?: string
        }
        Returns: Json
      }
      record_lead_action: {
        Args: {
          p_action: string
          p_details?: Json
          p_expected_version: number
          p_lead_id: string
          p_logo_path?: string
          p_note?: string
          p_request_id: string
          p_scheduled_at?: string
        }
        Returns: Json
      }
      register_reference_reply: {
        Args: { p_from: string; p_refs?: string[] }
        Returns: Json
      }
      release_batch: { Args: { p_batch_id: string }; Returns: Json }
      renew_lead_claim: {
        Args: { p_claim_id: string; p_release?: boolean }
        Returns: Json
      }
      reopen_lead: {
        Args: {
          p_expected_version: number
          p_lead_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      resolve_integration_review: {
        Args: {
          p_confirmed_absent?: boolean
          p_deal_id: number
          p_job_id: string
          p_organization_id: number
          p_person_id: number
        }
        Returns: undefined
      }
      retry_integration: { Args: { p_job_id: string }; Returns: Json }
      save_calendar_appointment: {
        Args: {
          p_country: string
          p_kind: string
          p_lead_id?: string
          p_notes: string
          p_self?: boolean
          p_starts_at: string
          p_title: string
        }
        Returns: string
      }
      save_offer: {
        Args: {
          p_customer_id: string
          p_expected_version?: number
          p_items: Json
          p_note?: string
          p_offer_id?: string
          p_request_id: string
        }
        Returns: Json
      }
      set_offer_status: {
        Args: {
          p_expected_version: number
          p_offer_id: string
          p_status: string
        }
        Returns: Json
      }
      set_user_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: undefined
      }
      set_user_fulfilment: {
        Args: { p_on: boolean; p_user_id: string }
        Returns: undefined
      }
      set_user_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      update_lead_contact: {
        Args: { p_contact: Json; p_expected_version: number; p_lead_id: string }
        Returns: Json
      }
      upsert_team_metrics: { Args: { p_rows: Json }; Returns: Json }
      user_role: { Args: { _uid: string }; Returns: string }
    }
    Enums: {
      app_role:
        | "admin"
        | "caller"
        | "fulfilment"
        | "recruit"
        | "veteran"
        | "manager"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "caller",
        "fulfilment",
        "recruit",
        "veteran",
        "manager",
      ],
    },
  },
} as const
