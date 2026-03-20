
-- Add food_type column to food_items table
ALTER TABLE public.food_items ADD COLUMN food_type text DEFAULT NULL;
