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
      analysis_results: {
        Row: {
          analysis_run_id: string
          id: string
          project_id: string
          result: Json
          result_key: string
        }
        Insert: {
          analysis_run_id: string
          id?: string
          project_id: string
          result: Json
          result_key: string
        }
        Update: {
          analysis_run_id?: string
          id?: string
          project_id?: string
          result?: Json
          result_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_results_project_id_analysis_run_id_fkey"
            columns: ["project_id", "analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      analysis_runs: {
        Row: {
          ai_status: string
          created_at: string
          created_by: string
          engine_version: string
          filters: Json
          id: string
          model_version: string | null
          project_id: string
          source_batch_ids: Json
          source_revision: string
          source_snapshot: Json
          status: string
        }
        Insert: {
          ai_status?: string
          created_at?: string
          created_by?: string
          engine_version: string
          filters: Json
          id?: string
          model_version?: string | null
          project_id: string
          source_batch_ids: Json
          source_revision: string
          source_snapshot: Json
          status: string
        }
        Update: {
          ai_status?: string
          created_at?: string
          created_by?: string
          engine_version?: string
          filters?: Json
          id?: string
          model_version?: string | null
          project_id?: string
          source_batch_ids?: Json
          source_revision?: string
          source_snapshot?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_analyses: {
        Row: {
          analysis_run_id: string
          comment_id: string
          evidence: Json
          id: string
          method_version: string
          project_id: string
          sentiment: string
          status: string
          topics: Json
        }
        Insert: {
          analysis_run_id: string
          comment_id: string
          evidence?: Json
          id?: string
          method_version: string
          project_id: string
          sentiment: string
          status: string
          topics?: Json
        }
        Update: {
          analysis_run_id?: string
          comment_id?: string
          evidence?: Json
          id?: string
          method_version?: string
          project_id?: string
          sentiment?: string
          status?: string
          topics?: Json
        }
        Relationships: [
          {
            foreignKeyName: "comment_analyses_project_id_analysis_run_id_fkey"
            columns: ["project_id", "analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "comment_analyses_project_id_comment_id_fkey"
            columns: ["project_id", "comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      comments: {
        Row: {
          comment_key: string | null
          comment_likes: number | null
          comment_text: string
          comment_time: string | null
          content_post_id: string
          created_at: string
          dedupe_confidence: string
          dedupe_hash: string
          dedupe_method: string
          external_comment_id: string | null
          id: string
          language: string | null
          parent_comment_external_id: string | null
          project_id: string
          reply_count: number | null
          sample_type: string
          source_batch_id: string
          source_row_number: number
          source_table: string | null
        }
        Insert: {
          comment_key?: string | null
          comment_likes?: number | null
          comment_text: string
          comment_time?: string | null
          content_post_id: string
          created_at?: string
          dedupe_confidence: string
          dedupe_hash: string
          dedupe_method: string
          external_comment_id?: string | null
          id?: string
          language?: string | null
          parent_comment_external_id?: string | null
          project_id: string
          reply_count?: number | null
          sample_type?: string
          source_batch_id: string
          source_row_number: number
          source_table?: string | null
        }
        Update: {
          comment_key?: string | null
          comment_likes?: number | null
          comment_text?: string
          comment_time?: string | null
          content_post_id?: string
          created_at?: string
          dedupe_confidence?: string
          dedupe_hash?: string
          dedupe_method?: string
          external_comment_id?: string | null
          id?: string
          language?: string | null
          parent_comment_external_id?: string | null
          project_id?: string
          reply_count?: number | null
          sample_type?: string
          source_batch_id?: string
          source_row_number?: number
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_project_id_content_post_id_fkey"
            columns: ["project_id", "content_post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_project_id_source_batch_id_fkey"
            columns: ["project_id", "source_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      content_posts: {
        Row: {
          content_key: string
          content_text: string | null
          content_type: string
          content_url: string | null
          created_at: string
          external_content_id: string | null
          id: string
          language: string | null
          platform: string
          project_id: string
          publish_time: string
          raw_content_type: string | null
          social_account_id: string | null
          source_batch_id: string
          source_row_number: number
          source_table: string | null
          tags: Json
          title: string
          topic: string | null
        }
        Insert: {
          content_key: string
          content_text?: string | null
          content_type: string
          content_url?: string | null
          created_at?: string
          external_content_id?: string | null
          id?: string
          language?: string | null
          platform: string
          project_id: string
          publish_time: string
          raw_content_type?: string | null
          social_account_id?: string | null
          source_batch_id: string
          source_row_number: number
          source_table?: string | null
          tags?: Json
          title: string
          topic?: string | null
        }
        Update: {
          content_key?: string
          content_text?: string | null
          content_type?: string
          content_url?: string | null
          created_at?: string
          external_content_id?: string | null
          id?: string
          language?: string | null
          platform?: string
          project_id?: string
          publish_time?: string
          raw_content_type?: string | null
          social_account_id?: string | null
          source_batch_id?: string
          source_row_number?: number
          source_table?: string | null
          tags?: Json
          title?: string
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_posts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_posts_project_id_platform_social_account_id_fkey"
            columns: ["project_id", "platform", "social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["project_id", "platform", "id"]
          },
          {
            foreignKeyName: "content_posts_project_id_source_batch_id_fkey"
            columns: ["project_id", "source_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      import_batches: {
        Row: {
          committed_at: string | null
          contains_personal_data: boolean
          created_at: string
          created_by: string
          data_owner_or_provider: string | null
          error_message: string | null
          field_mapping: Json
          file_hash: string
          file_manifest: Json
          file_name: string
          file_size_bytes: number
          id: string
          import_config: Json
          license_name: string
          license_verified: boolean
          mapping_version: string
          mime_type: string
          notes: string | null
          originals_cleanup_by: string | null
          originals_cleanup_started_at: string | null
          originals_deleted_at: string | null
          originals_state: string
          platform: string | null
          processing_version: string
          project_id: string
          public_demo_allowed: boolean
          quality_summary: Json
          request_hash: string | null
          row_counts: Json
          source_name: string
          source_type: string
          source_url: string | null
          status: string
          storage_bucket: string
          storage_path: string
          usage_scope: string | null
        }
        Insert: {
          committed_at?: string | null
          contains_personal_data?: boolean
          created_at?: string
          created_by?: string
          data_owner_or_provider?: string | null
          error_message?: string | null
          field_mapping?: Json
          file_hash: string
          file_manifest?: Json
          file_name: string
          file_size_bytes: number
          id?: string
          import_config?: Json
          license_name?: string
          license_verified?: boolean
          mapping_version?: string
          mime_type: string
          notes?: string | null
          originals_cleanup_by?: string | null
          originals_cleanup_started_at?: string | null
          originals_deleted_at?: string | null
          originals_state?: string
          platform?: string | null
          processing_version?: string
          project_id: string
          public_demo_allowed?: boolean
          quality_summary?: Json
          request_hash?: string | null
          row_counts?: Json
          source_name: string
          source_type: string
          source_url?: string | null
          status?: string
          storage_bucket?: string
          storage_path: string
          usage_scope?: string | null
        }
        Update: {
          committed_at?: string | null
          contains_personal_data?: boolean
          created_at?: string
          created_by?: string
          data_owner_or_provider?: string | null
          error_message?: string | null
          field_mapping?: Json
          file_hash?: string
          file_manifest?: Json
          file_name?: string
          file_size_bytes?: number
          id?: string
          import_config?: Json
          license_name?: string
          license_verified?: boolean
          mapping_version?: string
          mime_type?: string
          notes?: string | null
          originals_cleanup_by?: string | null
          originals_cleanup_started_at?: string | null
          originals_deleted_at?: string | null
          originals_state?: string
          platform?: string | null
          processing_version?: string
          project_id?: string
          public_demo_allowed?: boolean
          quality_summary?: Json
          request_hash?: string | null
          row_counts?: Json
          source_name?: string
          source_type?: string
          source_url?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string
          usage_scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_run_id: string
          content: Json
          id: string
          insight_key: string
          project_id: string
        }
        Insert: {
          analysis_run_id: string
          content: Json
          id?: string
          insight_key: string
          project_id: string
        }
        Update: {
          analysis_run_id?: string
          content?: Json
          id?: string
          insight_key?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_project_id_analysis_run_id_fkey"
            columns: ["project_id", "analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      post_metrics: {
        Row: {
          comments_count: number | null
          content_post_id: string
          created_at: string
          id: string
          impressions: number | null
          likes: number | null
          metric_profile: string
          missing_reasons: Json
          project_id: string
          raw_metrics: Json
          reach: number | null
          saves: number | null
          shares: number | null
          snapshot_time: string
          snapshot_type: string
          source_batch_id: string
          source_row_number: number
          source_table: string | null
          views: number | null
        }
        Insert: {
          comments_count?: number | null
          content_post_id: string
          created_at?: string
          id?: string
          impressions?: number | null
          likes?: number | null
          metric_profile: string
          missing_reasons?: Json
          project_id: string
          raw_metrics?: Json
          reach?: number | null
          saves?: number | null
          shares?: number | null
          snapshot_time: string
          snapshot_type?: string
          source_batch_id: string
          source_row_number: number
          source_table?: string | null
          views?: number | null
        }
        Update: {
          comments_count?: number | null
          content_post_id?: string
          created_at?: string
          id?: string
          impressions?: number | null
          likes?: number | null
          metric_profile?: string
          missing_reasons?: Json
          project_id?: string
          raw_metrics?: Json
          reach?: number | null
          saves?: number | null
          shares?: number | null
          snapshot_time?: string
          snapshot_type?: string
          source_batch_id?: string
          source_row_number?: number
          source_table?: string | null
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_metrics_project_id_content_post_id_fkey"
            columns: ["project_id", "content_post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "post_metrics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_metrics_project_id_source_batch_id_fkey"
            columns: ["project_id", "source_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      projects: {
        Row: {
          brand_name: string | null
          created_at: string
          default_timezone: string
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          brand_name?: string | null
          created_at?: string
          default_timezone?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          brand_name?: string | null
          created_at?: string
          default_timezone?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          analysis_run_id: string
          body: string
          created_at: string
          format: string
          id: string
          project_id: string
          title: string
        }
        Insert: {
          analysis_run_id: string
          body: string
          created_at?: string
          format: string
          id?: string
          project_id: string
          title: string
        }
        Update: {
          analysis_run_id?: string
          body?: string
          created_at?: string
          format?: string
          id?: string
          project_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_project_id_analysis_run_id_fkey"
            columns: ["project_id", "analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          account_key: string | null
          account_name: string | null
          account_type: string | null
          account_url: string | null
          created_at: string
          external_account_id: string | null
          id: string
          language: string | null
          platform: string
          project_id: string
        }
        Insert: {
          account_key?: string | null
          account_name?: string | null
          account_type?: string | null
          account_url?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          language?: string | null
          platform: string
          project_id: string
        }
        Update: {
          account_key?: string | null
          account_name?: string | null
          account_type?: string | null
          account_url?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          language?: string | null
          platform?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      begin_original_cleanup: { Args: { target_batch: string }; Returns: Json }
      commit_import_batch: {
        Args: {
          expected_config: Json
          expected_manifest: Json
          payload: Json
          target_batch: string
        }
        Returns: Json
      }
      finish_ai_call: {
        Args: {
          failure?: string
          final_state: string
          outcome?: Json
          provider_id?: string
          target_run: string
          token: string
        }
        Returns: Json
      }
      finish_original_cleanup: { Args: { target_batch: string }; Returns: Json }
      get_ai_call_status: { Args: never; Returns: Json }
      get_analysis_source: { Args: { target_project: string }; Returns: Json }
      reserve_ai_call: {
        Args: {
          allow_acquire?: boolean
          input_hash: string
          target_project: string
          target_run: string
          token: string
        }
        Returns: Json
      }
      save_analysis_bundle: {
        Args: {
          ai_state?: string
          analysis: Json
          model_name?: string
          report_body: string
          run_id: string
          source_data: Json
          target_project: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
