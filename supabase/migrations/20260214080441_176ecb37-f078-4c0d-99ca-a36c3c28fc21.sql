
-- Create meals table
CREATE TABLE public.meals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  color TEXT NOT NULL DEFAULT 'pink',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;

-- Public access policies (no auth required)
CREATE POLICY "Anyone can view meals" ON public.meals FOR SELECT USING (true);
CREATE POLICY "Anyone can insert meals" ON public.meals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update meals" ON public.meals FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete meals" ON public.meals FOR DELETE USING (true);
