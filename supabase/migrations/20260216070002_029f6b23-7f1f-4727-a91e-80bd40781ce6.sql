
-- Add grams and ingredients to meals
ALTER TABLE public.meals ADD COLUMN grams text;
ALTER TABLE public.meals ADD COLUMN ingredients text;

-- Add counter_start_date to possible_meals
ALTER TABLE public.possible_meals ADD COLUMN counter_start_date timestamptz;

-- Create shopping_groups table
CREATE TABLE public.shopping_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shopping_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can select shopping_groups" ON public.shopping_groups FOR SELECT USING (true);
CREATE POLICY "Anyone can insert shopping_groups" ON public.shopping_groups FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update shopping_groups" ON public.shopping_groups FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete shopping_groups" ON public.shopping_groups FOR DELETE USING (true);

-- Create shopping_items table
CREATE TABLE public.shopping_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id uuid REFERENCES public.shopping_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity text,
  checked boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can select shopping_items" ON public.shopping_items FOR SELECT USING (true);
CREATE POLICY "Anyone can insert shopping_items" ON public.shopping_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update shopping_items" ON public.shopping_items FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete shopping_items" ON public.shopping_items FOR DELETE USING (true);
