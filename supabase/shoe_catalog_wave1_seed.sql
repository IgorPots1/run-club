-- Curated wave 1 road-running catalog seed for the normalized shoe schema.
-- Scope:
-- - road running only
-- - modern versions from roughly the last 4-5 years
-- - clean, curated catalog over exhaustive coverage
-- - no category values populated in this wave
--
-- Expected volume: 193 shoe versions across 13 brands.
-- Requires:
-- - public.shoe_brands
-- - public.shoe_models_catalog
-- - public.shoe_versions

insert into public.shoe_brands (
  slug,
  name,
  is_active
)
values
  ('nike', 'Nike', true),
  ('adidas', 'adidas', true),
  ('asics', 'ASICS', true),
  ('new-balance', 'New Balance', true),
  ('hoka', 'HOKA', true),
  ('saucony', 'Saucony', true),
  ('brooks', 'Brooks', true),
  ('on', 'On', true),
  ('puma', 'Puma', true),
  ('anta', 'ANTA', true),
  ('xtep', 'Xtep', true),
  ('361-degrees', '361°', true),
  ('li-ning', 'Li-Ning', true)
on conflict (slug) do update
set
  name = excluded.name,
  is_active = excluded.is_active;

with model_seed (brand_slug, model_slug, model_name) as (
  values
    -- Nike
    ('nike', 'pegasus', 'Pegasus'),
    ('nike', 'vomero', 'Vomero'),
    ('nike', 'invincible', 'Invincible'),
    ('nike', 'alphafly', 'Alphafly'),
    ('nike', 'vaporfly', 'Vaporfly'),
    ('nike', 'zoom-fly', 'Zoom Fly'),
    ('nike', 'streakfly', 'Streakfly'),
    ('nike', 'structure', 'Structure'),
    ('nike', 'pegasus-plus', 'Pegasus Plus'),

    -- adidas
    ('adidas', 'adizero-boston', 'Adizero Boston'),
    ('adidas', 'adizero-adios-pro', 'Adizero Adios Pro'),
    ('adidas', 'adizero-takumi-sen', 'Adizero Takumi Sen'),
    ('adidas', 'adizero-adios', 'Adizero Adios'),
    ('adidas', 'adizero-sl', 'Adizero SL'),
    ('adidas', 'adizero-evo-sl', 'Adizero EVO SL'),
    ('adidas', 'supernova-rise', 'Supernova Rise'),

    -- ASICS
    ('asics', 'novablast', 'Novablast'),
    ('asics', 'superblast', 'Superblast'),
    ('asics', 'gel-nimbus', 'Gel-Nimbus'),
    ('asics', 'gel-cumulus', 'Gel-Cumulus'),
    ('asics', 'magic-speed', 'Magic Speed'),
    ('asics', 'metaspeed-sky', 'Metaspeed Sky'),
    ('asics', 'metaspeed-edge', 'Metaspeed Edge'),
    ('asics', 'gel-kayano', 'Gel-Kayano'),

    -- New Balance
    ('new-balance', 'fuelcell-rebel', 'FuelCell Rebel'),
    ('new-balance', 'fuelcell-sc-elite', 'FuelCell SC Elite'),
    ('new-balance', 'fuelcell-sc-trainer', 'FuelCell SC Trainer'),
    ('new-balance', 'fresh-foam-x-1080', 'Fresh Foam X 1080'),
    ('new-balance', 'fresh-foam-x-880', 'Fresh Foam X 880'),
    ('new-balance', 'fresh-foam-x-more', 'Fresh Foam X More'),
    ('new-balance', 'fuelcell-propel', 'FuelCell Propel'),
    ('new-balance', 'fresh-foam-x-balos', 'Fresh Foam X Balos'),

    -- HOKA
    ('hoka', 'clifton', 'Clifton'),
    ('hoka', 'bondi', 'Bondi'),
    ('hoka', 'mach', 'Mach'),
    ('hoka', 'rincon', 'Rincon'),
    ('hoka', 'rocket-x', 'Rocket X'),
    ('hoka', 'cielo-x1', 'Cielo X1'),
    ('hoka', 'skyward-x', 'Skyward X'),
    ('hoka', 'arahi', 'Arahi'),
    ('hoka', 'gaviota', 'Gaviota'),

    -- Saucony
    ('saucony', 'ride', 'Ride'),
    ('saucony', 'triumph', 'Triumph'),
    ('saucony', 'endorphin-speed', 'Endorphin Speed'),
    ('saucony', 'endorphin-pro', 'Endorphin Pro'),
    ('saucony', 'endorphin-elite', 'Endorphin Elite'),
    ('saucony', 'kinvara', 'Kinvara'),
    ('saucony', 'guide', 'Guide'),
    ('saucony', 'tempus', 'Tempus'),

    -- Brooks
    ('brooks', 'ghost', 'Ghost'),
    ('brooks', 'glycerin', 'Glycerin'),
    ('brooks', 'hyperion-max', 'Hyperion Max'),
    ('brooks', 'hyperion-elite', 'Hyperion Elite'),
    ('brooks', 'launch', 'Launch'),
    ('brooks', 'adrenaline-gts', 'Adrenaline GTS'),
    ('brooks', 'glycerin-max', 'Glycerin Max'),
    ('brooks', 'ghost-max', 'Ghost Max'),
    ('brooks', 'hyperion', 'Hyperion'),

    -- On
    ('on', 'cloudmonster', 'Cloudmonster'),
    ('on', 'cloudmonster-hyper', 'Cloudmonster Hyper'),
    ('on', 'cloudsurfer', 'Cloudsurfer'),
    ('on', 'cloudeclipse', 'Cloudeclipse'),
    ('on', 'cloudboom-echo', 'Cloudboom Echo'),
    ('on', 'cloudboom-strike', 'Cloudboom Strike'),
    ('on', 'cloudrunner', 'Cloudrunner'),
    ('on', 'cloudflow', 'Cloudflow'),
    ('on', 'cloudstratus', 'Cloudstratus'),

    -- Puma
    ('puma', 'deviate-nitro', 'Deviate Nitro'),
    ('puma', 'deviate-nitro-elite', 'Deviate Nitro Elite'),
    ('puma', 'velocity-nitro', 'Velocity Nitro'),
    ('puma', 'foreverrun-nitro', 'ForeverRun Nitro'),
    ('puma', 'magnify-nitro', 'Magnify Nitro'),
    ('puma', 'fast-r-nitro-elite', 'Fast-R Nitro Elite'),

    -- ANTA
    ('anta', 'c202', 'C202'),
    ('anta', 'pg7', 'PG7'),
    ('anta', 'mach', 'Mach'),
    ('anta', 'g21', 'G21'),

    -- Xtep
    ('xtep', '160x', '160X'),
    ('xtep', '260x', '260X'),
    ('xtep', '360x', '360X'),
    ('xtep', 'ultra-fast', 'Ultra Fast'),

    -- 361°
    ('361-degrees', 'flame', 'Flame'),
    ('361-degrees', 'furious-future', 'Furious Future'),
    ('361-degrees', 'miro-nude', 'Miro Nude'),

    -- Li-Ning
    ('li-ning', 'feidian', 'Feidian'),
    ('li-ning', 'feidian-challenger', 'Feidian Challenger')
)
insert into public.shoe_models_catalog (
  brand_id,
  slug,
  name,
  is_active
)
select
  shoe_brands.id,
  model_seed.model_slug,
  model_seed.model_name,
  true
from model_seed
join public.shoe_brands
  on shoe_brands.slug = model_seed.brand_slug
on conflict (brand_id, slug) do update
set
  name = excluded.name,
  is_active = excluded.is_active;

with seeded_models as (
  select
    shoe_models_catalog.id
  from public.shoe_models_catalog
  join public.shoe_brands
    on shoe_brands.id = shoe_models_catalog.brand_id
  where (shoe_brands.slug, shoe_models_catalog.slug) in (
    values
      ('nike', 'pegasus'),
      ('nike', 'vomero'),
      ('nike', 'invincible'),
      ('nike', 'alphafly'),
      ('nike', 'vaporfly'),
      ('nike', 'zoom-fly'),
      ('nike', 'streakfly'),
      ('nike', 'structure'),
      ('nike', 'pegasus-plus'),
      ('adidas', 'adizero-boston'),
      ('adidas', 'adizero-adios-pro'),
      ('adidas', 'adizero-takumi-sen'),
      ('adidas', 'adizero-adios'),
      ('adidas', 'adizero-sl'),
      ('adidas', 'adizero-evo-sl'),
      ('adidas', 'supernova-rise'),
      ('asics', 'novablast'),
      ('asics', 'superblast'),
      ('asics', 'gel-nimbus'),
      ('asics', 'gel-cumulus'),
      ('asics', 'magic-speed'),
      ('asics', 'metaspeed-sky'),
      ('asics', 'metaspeed-edge'),
      ('asics', 'gel-kayano'),
      ('new-balance', 'fuelcell-rebel'),
      ('new-balance', 'fuelcell-sc-elite'),
      ('new-balance', 'fuelcell-sc-trainer'),
      ('new-balance', 'fresh-foam-x-1080'),
      ('new-balance', 'fresh-foam-x-880'),
      ('new-balance', 'fresh-foam-x-more'),
      ('new-balance', 'fuelcell-propel'),
      ('new-balance', 'fresh-foam-x-balos'),
      ('hoka', 'clifton'),
      ('hoka', 'bondi'),
      ('hoka', 'mach'),
      ('hoka', 'rincon'),
      ('hoka', 'rocket-x'),
      ('hoka', 'cielo-x1'),
      ('hoka', 'skyward-x'),
      ('hoka', 'arahi'),
      ('hoka', 'gaviota'),
      ('saucony', 'ride'),
      ('saucony', 'triumph'),
      ('saucony', 'endorphin-speed'),
      ('saucony', 'endorphin-pro'),
      ('saucony', 'endorphin-elite'),
      ('saucony', 'kinvara'),
      ('saucony', 'guide'),
      ('saucony', 'tempus'),
      ('brooks', 'ghost'),
      ('brooks', 'glycerin'),
      ('brooks', 'hyperion-max'),
      ('brooks', 'hyperion-elite'),
      ('brooks', 'launch'),
      ('brooks', 'adrenaline-gts'),
      ('brooks', 'glycerin-max'),
      ('brooks', 'ghost-max'),
      ('brooks', 'hyperion'),
      ('on', 'cloudmonster'),
      ('on', 'cloudmonster-hyper'),
      ('on', 'cloudsurfer'),
      ('on', 'cloudeclipse'),
      ('on', 'cloudboom-echo'),
      ('on', 'cloudboom-strike'),
      ('on', 'cloudrunner'),
      ('on', 'cloudflow'),
      ('on', 'cloudstratus'),
      ('puma', 'deviate-nitro'),
      ('puma', 'deviate-nitro-elite'),
      ('puma', 'velocity-nitro'),
      ('puma', 'foreverrun-nitro'),
      ('puma', 'magnify-nitro'),
      ('puma', 'fast-r-nitro-elite'),
      ('anta', 'c202'),
      ('anta', 'pg7'),
      ('anta', 'mach'),
      ('anta', 'g21'),
      ('xtep', '160x'),
      ('xtep', '260x'),
      ('xtep', '360x'),
      ('xtep', 'ultra-fast'),
      ('361-degrees', 'flame'),
      ('361-degrees', 'furious-future'),
      ('361-degrees', 'miro-nude'),
      ('li-ning', 'feidian'),
      ('li-ning', 'feidian-challenger')
  )
)
update public.shoe_versions
set is_current = false
where model_id in (select id from seeded_models);

with version_seed (
  brand_slug,
  model_slug,
  version_name,
  full_name,
  is_current
) as (
  values
    -- Nike
    ('nike', 'pegasus', '38', 'Nike Pegasus 38', false),
    ('nike', 'pegasus', '39', 'Nike Pegasus 39', false),
    ('nike', 'pegasus', '40', 'Nike Pegasus 40', false),
    ('nike', 'pegasus', '41', 'Nike Pegasus 41', true),
    ('nike', 'vomero', '16', 'Nike Vomero 16', false),
    ('nike', 'vomero', '17', 'Nike Vomero 17', false),
    ('nike', 'vomero', '18', 'Nike Vomero 18', true),
    ('nike', 'invincible', '2', 'Nike Invincible 2', false),
    ('nike', 'invincible', '3', 'Nike Invincible 3', false),
    ('nike', 'invincible', '4', 'Nike Invincible 4', true),
    ('nike', 'alphafly', 'NEXT% 2', 'Nike Alphafly NEXT% 2', false),
    ('nike', 'alphafly', '3', 'Nike Alphafly 3', true),
    ('nike', 'vaporfly', 'NEXT% 2', 'Nike Vaporfly NEXT% 2', false),
    ('nike', 'vaporfly', '3', 'Nike Vaporfly 3', false),
    ('nike', 'vaporfly', '4', 'Nike Vaporfly 4', true),
    ('nike', 'zoom-fly', '5', 'Nike Zoom Fly 5', false),
    ('nike', 'zoom-fly', '6', 'Nike Zoom Fly 6', true),
    ('nike', 'streakfly', '1', 'Nike Streakfly', false),
    ('nike', 'streakfly', '2', 'Nike Streakfly 2', true),
    ('nike', 'structure', '25', 'Nike Structure 25', false),
    ('nike', 'structure', '26', 'Nike Structure 26', true),
    ('nike', 'pegasus-plus', '1', 'Nike Pegasus Plus', true),

    -- adidas
    ('adidas', 'adizero-boston', '10', 'adidas Adizero Boston 10', false),
    ('adidas', 'adizero-boston', '11', 'adidas Adizero Boston 11', false),
    ('adidas', 'adizero-boston', '12', 'adidas Adizero Boston 12', false),
    ('adidas', 'adizero-boston', '13', 'adidas Adizero Boston 13', true),
    ('adidas', 'adizero-adios-pro', '2', 'adidas Adizero Adios Pro 2', false),
    ('adidas', 'adizero-adios-pro', '3', 'adidas Adizero Adios Pro 3', false),
    ('adidas', 'adizero-adios-pro', '4', 'adidas Adizero Adios Pro 4', true),
    ('adidas', 'adizero-takumi-sen', '8', 'adidas Adizero Takumi Sen 8', false),
    ('adidas', 'adizero-takumi-sen', '9', 'adidas Adizero Takumi Sen 9', false),
    ('adidas', 'adizero-takumi-sen', '10', 'adidas Adizero Takumi Sen 10', false),
    ('adidas', 'adizero-takumi-sen', '11', 'adidas Adizero Takumi Sen 11', true),
    ('adidas', 'adizero-adios', '7', 'adidas Adizero Adios 7', false),
    ('adidas', 'adizero-adios', '8', 'adidas Adizero Adios 8', false),
    ('adidas', 'adizero-adios', '9', 'adidas Adizero Adios 9', true),
    ('adidas', 'adizero-sl', '1', 'adidas Adizero SL', false),
    ('adidas', 'adizero-sl', '2', 'adidas Adizero SL2', true),
    ('adidas', 'adizero-evo-sl', '1', 'adidas Adizero EVO SL', true),
    ('adidas', 'supernova-rise', '1', 'adidas Supernova Rise', true),

    -- ASICS
    ('asics', 'novablast', '2', 'ASICS Novablast 2', false),
    ('asics', 'novablast', '3', 'ASICS Novablast 3', false),
    ('asics', 'novablast', '4', 'ASICS Novablast 4', false),
    ('asics', 'novablast', '5', 'ASICS Novablast 5', true),
    ('asics', 'superblast', '1', 'ASICS Superblast', false),
    ('asics', 'superblast', '2', 'ASICS Superblast 2', true),
    ('asics', 'gel-nimbus', '24', 'ASICS Gel-Nimbus 24', false),
    ('asics', 'gel-nimbus', '25', 'ASICS Gel-Nimbus 25', false),
    ('asics', 'gel-nimbus', '26', 'ASICS Gel-Nimbus 26', false),
    ('asics', 'gel-nimbus', '27', 'ASICS Gel-Nimbus 27', true),
    ('asics', 'gel-cumulus', '25', 'ASICS Gel-Cumulus 25', false),
    ('asics', 'gel-cumulus', '26', 'ASICS Gel-Cumulus 26', false),
    ('asics', 'gel-cumulus', '27', 'ASICS Gel-Cumulus 27', true),
    ('asics', 'magic-speed', '2', 'ASICS Magic Speed 2', false),
    ('asics', 'magic-speed', '3', 'ASICS Magic Speed 3', false),
    ('asics', 'magic-speed', '4', 'ASICS Magic Speed 4', true),
    ('asics', 'metaspeed-sky', '+', 'ASICS Metaspeed Sky+', false),
    ('asics', 'metaspeed-sky', 'Paris', 'ASICS Metaspeed Sky Paris', true),
    ('asics', 'metaspeed-edge', '+', 'ASICS Metaspeed Edge+', false),
    ('asics', 'metaspeed-edge', 'Paris', 'ASICS Metaspeed Edge Paris', true),
    ('asics', 'gel-kayano', '30', 'ASICS Gel-Kayano 30', false),
    ('asics', 'gel-kayano', '31', 'ASICS Gel-Kayano 31', true),

    -- New Balance
    ('new-balance', 'fuelcell-rebel', 'v2', 'New Balance FuelCell Rebel v2', false),
    ('new-balance', 'fuelcell-rebel', 'v3', 'New Balance FuelCell Rebel v3', false),
    ('new-balance', 'fuelcell-rebel', 'v4', 'New Balance FuelCell Rebel v4', false),
    ('new-balance', 'fuelcell-rebel', 'v5', 'New Balance FuelCell Rebel v5', true),
    ('new-balance', 'fuelcell-sc-elite', 'v3', 'New Balance FuelCell SC Elite v3', false),
    ('new-balance', 'fuelcell-sc-elite', 'v4', 'New Balance FuelCell SC Elite v4', false),
    ('new-balance', 'fuelcell-sc-elite', 'v5', 'New Balance FuelCell SC Elite v5', true),
    ('new-balance', 'fuelcell-sc-trainer', 'v1', 'New Balance FuelCell SC Trainer v1', false),
    ('new-balance', 'fuelcell-sc-trainer', 'v2', 'New Balance FuelCell SC Trainer v2', false),
    ('new-balance', 'fuelcell-sc-trainer', 'v3', 'New Balance FuelCell SC Trainer v3', true),
    ('new-balance', 'fresh-foam-x-1080', 'v12', 'New Balance Fresh Foam X 1080 v12', false),
    ('new-balance', 'fresh-foam-x-1080', 'v13', 'New Balance Fresh Foam X 1080 v13', false),
    ('new-balance', 'fresh-foam-x-1080', 'v14', 'New Balance Fresh Foam X 1080 v14', true),
    ('new-balance', 'fresh-foam-x-880', 'v13', 'New Balance Fresh Foam X 880 v13', false),
    ('new-balance', 'fresh-foam-x-880', 'v14', 'New Balance Fresh Foam X 880 v14', false),
    ('new-balance', 'fresh-foam-x-880', 'v15', 'New Balance Fresh Foam X 880 v15', true),
    ('new-balance', 'fresh-foam-x-more', 'v4', 'New Balance Fresh Foam X More v4', false),
    ('new-balance', 'fresh-foam-x-more', 'v5', 'New Balance Fresh Foam X More v5', true),
    ('new-balance', 'fuelcell-propel', 'v4', 'New Balance FuelCell Propel v4', false),
    ('new-balance', 'fuelcell-propel', 'v5', 'New Balance FuelCell Propel v5', true),
    ('new-balance', 'fresh-foam-x-balos', '1', 'New Balance Fresh Foam X Balos', true),

    -- HOKA
    ('hoka', 'clifton', '8', 'HOKA Clifton 8', false),
    ('hoka', 'clifton', '9', 'HOKA Clifton 9', false),
    ('hoka', 'clifton', '10', 'HOKA Clifton 10', true),
    ('hoka', 'bondi', '8', 'HOKA Bondi 8', false),
    ('hoka', 'bondi', '9', 'HOKA Bondi 9', true),
    ('hoka', 'mach', '5', 'HOKA Mach 5', false),
    ('hoka', 'mach', '6', 'HOKA Mach 6', false),
    ('hoka', 'mach', 'X', 'HOKA Mach X', true),
    ('hoka', 'rincon', '3', 'HOKA Rincon 3', false),
    ('hoka', 'rincon', '4', 'HOKA Rincon 4', true),
    ('hoka', 'rocket-x', '2', 'HOKA Rocket X 2', true),
    ('hoka', 'cielo-x1', '1', 'HOKA Cielo X1', false),
    ('hoka', 'cielo-x1', '2.0', 'HOKA Cielo X1 2.0', true),
    ('hoka', 'skyward-x', '1', 'HOKA Skyward X', true),
    ('hoka', 'arahi', '7', 'HOKA Arahi 7', false),
    ('hoka', 'arahi', '8', 'HOKA Arahi 8', true),
    ('hoka', 'gaviota', '5', 'HOKA Gaviota 5', true),

    -- Saucony
    ('saucony', 'ride', '16', 'Saucony Ride 16', false),
    ('saucony', 'ride', '17', 'Saucony Ride 17', false),
    ('saucony', 'ride', '18', 'Saucony Ride 18', true),
    ('saucony', 'triumph', '21', 'Saucony Triumph 21', false),
    ('saucony', 'triumph', '22', 'Saucony Triumph 22', true),
    ('saucony', 'endorphin-speed', '2', 'Saucony Endorphin Speed 2', false),
    ('saucony', 'endorphin-speed', '3', 'Saucony Endorphin Speed 3', false),
    ('saucony', 'endorphin-speed', '4', 'Saucony Endorphin Speed 4', false),
    ('saucony', 'endorphin-speed', '5', 'Saucony Endorphin Speed 5', true),
    ('saucony', 'endorphin-pro', '2', 'Saucony Endorphin Pro 2', false),
    ('saucony', 'endorphin-pro', '3', 'Saucony Endorphin Pro 3', false),
    ('saucony', 'endorphin-pro', '4', 'Saucony Endorphin Pro 4', false),
    ('saucony', 'endorphin-pro', '5', 'Saucony Endorphin Pro 5', true),
    ('saucony', 'endorphin-elite', '1', 'Saucony Endorphin Elite', false),
    ('saucony', 'endorphin-elite', '2', 'Saucony Endorphin Elite 2', true),
    ('saucony', 'kinvara', '13', 'Saucony Kinvara 13', false),
    ('saucony', 'kinvara', '14', 'Saucony Kinvara 14', false),
    ('saucony', 'kinvara', '15', 'Saucony Kinvara 15', false),
    ('saucony', 'kinvara', '16', 'Saucony Kinvara 16', true),
    ('saucony', 'guide', '17', 'Saucony Guide 17', false),
    ('saucony', 'guide', '18', 'Saucony Guide 18', true),
    ('saucony', 'tempus', '1', 'Saucony Tempus', false),
    ('saucony', 'tempus', '2', 'Saucony Tempus 2', true),

    -- Brooks
    ('brooks', 'ghost', '14', 'Brooks Ghost 14', false),
    ('brooks', 'ghost', '15', 'Brooks Ghost 15', false),
    ('brooks', 'ghost', '16', 'Brooks Ghost 16', false),
    ('brooks', 'ghost', '17', 'Brooks Ghost 17', true),
    ('brooks', 'glycerin', '20', 'Brooks Glycerin 20', false),
    ('brooks', 'glycerin', '21', 'Brooks Glycerin 21', false),
    ('brooks', 'glycerin', '22', 'Brooks Glycerin 22', true),
    ('brooks', 'hyperion-max', '1', 'Brooks Hyperion Max', false),
    ('brooks', 'hyperion-max', '2', 'Brooks Hyperion Max 2', true),
    ('brooks', 'hyperion-elite', '3', 'Brooks Hyperion Elite 3', false),
    ('brooks', 'hyperion-elite', '4', 'Brooks Hyperion Elite 4', true),
    ('brooks', 'launch', '10', 'Brooks Launch 10', false),
    ('brooks', 'launch', '11', 'Brooks Launch 11', true),
    ('brooks', 'adrenaline-gts', '23', 'Brooks Adrenaline GTS 23', false),
    ('brooks', 'adrenaline-gts', '24', 'Brooks Adrenaline GTS 24', true),
    ('brooks', 'glycerin-max', '1', 'Brooks Glycerin Max', true),
    ('brooks', 'ghost-max', '1', 'Brooks Ghost Max', false),
    ('brooks', 'ghost-max', '2', 'Brooks Ghost Max 2', true),
    ('brooks', 'hyperion', '1', 'Brooks Hyperion', false),
    ('brooks', 'hyperion', '2', 'Brooks Hyperion 2', true),

    -- On
    ('on', 'cloudmonster', '1', 'On Cloudmonster', false),
    ('on', 'cloudmonster', '2', 'On Cloudmonster 2', true),
    ('on', 'cloudmonster-hyper', '1', 'On Cloudmonster Hyper', true),
    ('on', 'cloudsurfer', '1', 'On Cloudsurfer', false),
    ('on', 'cloudsurfer', '2', 'On Cloudsurfer 2', true),
    ('on', 'cloudeclipse', '1', 'On Cloudeclipse', true),
    ('on', 'cloudboom-echo', '3', 'On Cloudboom Echo 3', true),
    ('on', 'cloudboom-strike', '1', 'On Cloudboom Strike', true),
    ('on', 'cloudrunner', '2', 'On Cloudrunner 2', true),
    ('on', 'cloudflow', '4', 'On Cloudflow 4', true),
    ('on', 'cloudstratus', '3', 'On Cloudstratus 3', true),

    -- Puma
    ('puma', 'deviate-nitro', '2', 'Puma Deviate Nitro 2', false),
    ('puma', 'deviate-nitro', '3', 'Puma Deviate Nitro 3', true),
    ('puma', 'deviate-nitro-elite', '2', 'Puma Deviate Nitro Elite 2', false),
    ('puma', 'deviate-nitro-elite', '3', 'Puma Deviate Nitro Elite 3', true),
    ('puma', 'velocity-nitro', '2', 'Puma Velocity Nitro 2', false),
    ('puma', 'velocity-nitro', '3', 'Puma Velocity Nitro 3', true),
    ('puma', 'foreverrun-nitro', '1', 'Puma ForeverRun Nitro', false),
    ('puma', 'foreverrun-nitro', '2', 'Puma ForeverRun Nitro 2', true),
    ('puma', 'magnify-nitro', '2', 'Puma Magnify Nitro 2', false),
    ('puma', 'magnify-nitro', '3', 'Puma Magnify Nitro 3', true),
    ('puma', 'fast-r-nitro-elite', '2', 'Puma Fast-R Nitro Elite 2', false),
    ('puma', 'fast-r-nitro-elite', '3', 'Puma Fast-R Nitro Elite 3', true),

    -- ANTA
    ('anta', 'c202', '5', 'ANTA C202 5', false),
    ('anta', 'c202', '5 Pro', 'ANTA C202 5 Pro', false),
    ('anta', 'c202', '6', 'ANTA C202 6', true),
    ('anta', 'c202', '6 Pro', 'ANTA C202 6 Pro', true),
    ('anta', 'pg7', '1', 'ANTA PG7', true),
    ('anta', 'mach', '4.0', 'ANTA Mach 4.0', true),
    ('anta', 'mach', '4 Pro', 'ANTA Mach 4 Pro', true),
    ('anta', 'g21', '3', 'ANTA G21 3', false),
    ('anta', 'g21', '3 Pro', 'ANTA G21 3 Pro', true),

    -- Xtep
    ('xtep', '160x', '5.0', 'Xtep 160X 5.0', false),
    ('xtep', '160x', '5.0 Pro', 'Xtep 160X 5.0 Pro', false),
    ('xtep', '160x', '6.0', 'Xtep 160X 6.0', true),
    ('xtep', '160x', '6.0 Pro', 'Xtep 160X 6.0 Pro', true),
    ('xtep', '160x', '6.0 MONXTER', 'Xtep 160X 6.0 MONXTER', true),
    ('xtep', '260x', '3.0', 'Xtep 260X 3.0', true),
    ('xtep', '360x', '1', 'Xtep 360X', true),
    ('xtep', 'ultra-fast', '5.0', 'Xtep Ultra Fast 5.0', true),

    -- 361°
    ('361-degrees', 'flame', '4 ET', '361° Flame 4 ET', false),
    ('361-degrees', 'flame', '4.5', '361° Flame 4.5', false),
    ('361-degrees', 'flame', '4.5 MIX', '361° Flame 4.5 MIX', false),
    ('361-degrees', 'flame', '5', '361° Flame 5', true),
    ('361-degrees', 'furious-future', '2.0', '361° Furious Future 2.0', true),
    ('361-degrees', 'miro-nude', '1', '361° Miro Nude', true),

    -- Li-Ning
    ('li-ning', 'feidian', '3.0 Ultra', 'Li-Ning Feidian 3.0 Ultra', false),
    ('li-ning', 'feidian', '5 Elite', 'Li-Ning Feidian 5 Elite', true),
    ('li-ning', 'feidian-challenger', '1', 'Li-Ning Feidian Challenger', false),
    ('li-ning', 'feidian-challenger', 'Sunrise V2', 'Li-Ning Feidian Challenger Sunrise V2', true)
)
insert into public.shoe_versions (
  model_id,
  version_name,
  full_name,
  is_current,
  is_searchable
)
select
  shoe_models_catalog.id,
  version_seed.version_name,
  version_seed.full_name,
  version_seed.is_current,
  true
from version_seed
join public.shoe_brands
  on shoe_brands.slug = version_seed.brand_slug
join public.shoe_models_catalog
  on shoe_models_catalog.brand_id = shoe_brands.id
 and shoe_models_catalog.slug = version_seed.model_slug
on conflict (model_id, version_name) do update
set
  full_name = excluded.full_name,
  is_current = excluded.is_current,
  is_searchable = excluded.is_searchable;
