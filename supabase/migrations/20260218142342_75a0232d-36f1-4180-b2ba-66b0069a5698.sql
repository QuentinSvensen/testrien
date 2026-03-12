
CREATE TABLE public.food_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid DEFAULT auth.uid(),
  name text NOT NULL,
  grams text NULL,
  calories text NULL,
  expiration_date date NULL,
  counter_start_date timestamp with time zone NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.food_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view food_items"
  ON public.food_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert food_items"
  ON public.food_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update food_items"
  ON public.food_items FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete food_items"
  ON public.food_items FOR DELETE
  USING (auth.uid() IS NOT NULL);
