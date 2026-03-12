
-- Add cuisson (cooking) fields to meals
ALTER TABLE public.meals ADD COLUMN oven_temp text DEFAULT NULL;
ALTER TABLE public.meals ADD COLUMN oven_minutes text DEFAULT NULL;

-- Add quantity (item count, not weight) to food_items  
ALTER TABLE public.food_items ADD COLUMN quantity integer DEFAULT NULL;

-- Add storage_type to food_items (frigo, sec, surgele) replacing is_dry boolean
ALTER TABLE public.food_items ADD COLUMN storage_type text NOT NULL DEFAULT 'frigo';

-- Migrate existing data: is_dry=true → 'sec', is_dry=false → 'frigo'
UPDATE public.food_items SET storage_type = CASE WHEN is_dry = true THEN 'sec' ELSE 'frigo' END;
