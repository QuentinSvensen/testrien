ALTER TABLE public.shopping_items
  ADD COLUMN content_quantity text DEFAULT NULL,
  ADD COLUMN secondary_checked boolean NOT NULL DEFAULT false;