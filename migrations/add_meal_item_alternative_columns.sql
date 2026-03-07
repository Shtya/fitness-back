-- Add alternative item columns to meal_items
ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS alternative_name VARCHAR(200) NULL;
ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS alternative_quantity DECIMAL(10,2) NULL;
ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS alternative_unit VARCHAR(20) NULL;
ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS alternative_calories DECIMAL(8,2) NULL;
