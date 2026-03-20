ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS is_meal boolean NOT NULL DEFAULT false;
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS is_infinite boolean NOT NULL DEFAULT false;