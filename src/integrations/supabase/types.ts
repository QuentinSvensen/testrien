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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      food_items: {
        Row: {
          calories: string | null
          counter_start_date: string | null
          created_at: string
          expiration_date: string | null
          food_type: string | null
          grams: string | null
          id: string
          is_dry: boolean
          is_indivisible: boolean
          is_infinite: boolean
          is_meal: boolean
          name: string
          protein: string | null
          quantity: number | null
          sort_order: number
          storage_type: string
          user_id: string | null
        }
        Insert: {
          calories?: string | null
          counter_start_date?: string | null
          created_at?: string
          expiration_date?: string | null
          food_type?: string | null
          grams?: string | null
          id?: string
          is_dry?: boolean
          is_indivisible?: boolean
          is_infinite?: boolean
          is_meal?: boolean
          name: string
          protein?: string | null
          quantity?: number | null
          sort_order?: number
          storage_type?: string
          user_id?: string | null
        }
        Update: {
          calories?: string | null
          counter_start_date?: string | null
          created_at?: string
          expiration_date?: string | null
          food_type?: string | null
          grams?: string | null
          id?: string
          is_dry?: boolean
          is_indivisible?: boolean
          is_infinite?: boolean
          is_meal?: boolean
          name?: string
          protein?: string | null
          quantity?: number | null
          sort_order?: number
          storage_type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      meals: {
        Row: {
          calories: string | null
          category: string
          color: string
          created_at: string
          grams: string | null
          id: string
          ingredients: string | null
          is_available: boolean
          is_favorite: boolean
          name: string
          oven_minutes: string | null
          oven_temp: string | null
          protein: string | null
          sort_order: number
          user_id: string | null
        }
        Insert: {
          calories?: string | null
          category?: string
          color?: string
          created_at?: string
          grams?: string | null
          id?: string
          ingredients?: string | null
          is_available?: boolean
          is_favorite?: boolean
          name: string
          oven_minutes?: string | null
          oven_temp?: string | null
          protein?: string | null
          sort_order?: number
          user_id?: string | null
        }
        Update: {
          calories?: string | null
          category?: string
          color?: string
          created_at?: string
          grams?: string | null
          id?: string
          ingredients?: string | null
          is_available?: boolean
          is_favorite?: boolean
          name?: string
          oven_minutes?: string | null
          oven_temp?: string | null
          protein?: string | null
          sort_order?: number
          user_id?: string | null
        }
        Relationships: []
      }
      pin_attempts: {
        Row: {
          created_at: string
          id: string
          ip: string
          success: boolean | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip: string
          success?: boolean | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string
          success?: boolean | null
        }
        Relationships: []
      }
      pin_attempts_meta: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value?: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      possible_meals: {
        Row: {
          counter_start_date: string | null
          created_at: string
          day_of_week: string | null
          expiration_date: string | null
          id: string
          ingredients_override: string | null
          meal_id: string
          meal_time: string | null
          quantity: number
          sort_order: number
          user_id: string | null
        }
        Insert: {
          counter_start_date?: string | null
          created_at?: string
          day_of_week?: string | null
          expiration_date?: string | null
          id?: string
          ingredients_override?: string | null
          meal_id: string
          meal_time?: string | null
          quantity?: number
          sort_order?: number
          user_id?: string | null
        }
        Update: {
          counter_start_date?: string | null
          created_at?: string
          day_of_week?: string | null
          expiration_date?: string | null
          id?: string
          ingredients_override?: string | null
          meal_id?: string
          meal_time?: string | null
          quantity?: number
          sort_order?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "possible_meals_meal_id_fkey"
            columns: ["meal_id"]
            isOneToOne: false
            referencedRelation: "meals"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          user_id?: string | null
        }
        Relationships: []
      }
      shopping_items: {
        Row: {
          brand: string | null
          checked: boolean
          content_quantity: string | null
          content_quantity_type: string | null
          created_at: string
          group_id: string | null
          id: string
          name: string
          quantity: string | null
          secondary_checked: boolean
          sort_order: number
          user_id: string | null
        }
        Insert: {
          brand?: string | null
          checked?: boolean
          content_quantity?: string | null
          content_quantity_type?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          name: string
          quantity?: string | null
          secondary_checked?: boolean
          sort_order?: number
          user_id?: string | null
        }
        Update: {
          brand?: string | null
          checked?: boolean
          content_quantity?: string | null
          content_quantity_type?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          name?: string
          quantity?: string | null
          secondary_checked?: boolean
          sort_order?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopping_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "shopping_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id?: string | null
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string | null
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
