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
      appointments: {
        Row: {
          created_at: string
          id: string
          lead_id: string | null
          notes: string | null
          starts_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          starts_at: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          starts_at?: string
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
          created_at: string
          done: boolean
          due_at: string
          id: string
          lead_id: string
          user_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          done?: boolean
          due_at: string
          id?: string
          lead_id: string
          user_id?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          done?: boolean
          due_at?: string
          id?: string
          lead_id?: string
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
      lead_batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          import_state: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          import_state?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          import_state?: string
          name?: string
        }
        Relationships: []
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
      offer_customers: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          address?: string | null
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
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_quality: {
        Args: { p_kind: string; p_lead_id: string; p_reason: string }
        Returns: undefined
      }
      archive_leads: { Args: { p_ids: string[] }; Returns: number }
      archive_open_leads: { Args: never; Returns: number }
      backend_maintenance: { Args: never; Returns: Json }
      checkpoint_integration: {
        Args: {
          p_external_id: number
          p_job_id: string
          p_kind: string
          p_lease_token: string
        }
        Returns: undefined
      }
      claim_integration_jobs: { Args: { p_limit?: number }; Returns: Json }
      claim_next_lead: { Args: never; Returns: Json }
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
      get_batch_progress: { Args: never; Returns: Json }
      get_capabilities: { Args: never; Returns: Json }
      get_dashboard: {
        Args: { p_from: string; p_scope?: string; p_to: string }
        Returns: Json
      }
      get_quality_issues: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_duplicates: { Args: { p_batch_id: string }; Returns: Json }
      move_lead: {
        Args: {
          p_batch_id: string
          p_expected_version: number
          p_lead_id: string
        }
        Returns: undefined
      }
      preview_import: {
        Args: {
          p_batch_id?: string
          p_name: string
          p_request_id: string
          p_rows: Json
        }
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
    }
    Enums: {
      app_role: "admin" | "caller"
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
      app_role: ["admin", "caller"],
    },
  },
} as const
