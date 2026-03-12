ALTER TABLE public.food_items ADD COLUMN no_counter boolean NOT NULL DEFAULT false;
UPDATE public.food_items SET no_counter = true WHERE storage_type = 'surgele';