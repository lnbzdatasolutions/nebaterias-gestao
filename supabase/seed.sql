-- =====================================================================
--  Sistema de Gestão · N E Baterias (Fortaleza-CE)
--  Arquivo : supabase/seed.sql
--  Rodar UMA vez, logo após o schema.sql (Supabase → SQL Editor).
--  Preços, custos e estoque NÃO entram aqui: o estoque e o custo vêm da
--  primeira compra (tela Entrada) e o preço de venda pela tela Produtos.
-- =====================================================================

-- Configuração da loja (garantia padrão de 12 meses: CONFIRMAR com o dono)
insert into public.loja_config (id, nome_loja, telefone, endereco, instagram, site,
                                garantia_padrao_meses, rodape_comprovante)
values (1, 'N E Baterias', '(85) 98710-5240 / (85) 99755-5371',
        'Av. Alberto Magno, 754, Fortaleza - CE', '@nebaterias', 'https://linktr.ee/nebateriasoficial', 12,
        'Entrega, instalação e check-up elétrico grátis. Guarde este comprovante para a garantia.')
on conflict (id) do nothing;

-- Formas de pagamento (preencher as taxas reais da maquininha depois)
insert into public.formas_pagamento (nome, taxa_percentual, permite_parcelas, ordem) values
  ('Dinheiro', 0, false, 1),
  ('Pix',      0, false, 2),
  ('Débito',   0, false, 3),
  ('Crédito',  0, true,  4)
on conflict (nome) do nothing;

-- Catálogo inicial Moura (conferir códigos com o revendedor antes de usar).
-- A loja também vende Heliar e Zetta: cadastrar pela tela Produtos (marca + modelo).
insert into public.produtos (modelo, linha, marca, tipo_veiculo, aplicacoes, estoque_minimo) values
  ('MA5-D',     'Moura Moto',        'Moura', 'Motocicletas pequenas',                       'Honda CG, Honda Biz', 1),
  ('MA6-D',     'Moura Moto',        'Moura', 'Motocicletas médias',                         'Yamaha YBR, Yamaha Fazer', 1),
  ('MA7-E',     'Moura Moto',        'Moura', 'Motocicletas grandes',                        'BMW GS', 1),
  ('M40SD',     'Moura Automotiva',  'Moura', 'Carros pequenos / populares',                 'Fiat Uno, Chevrolet Celta, Ford Ka, VW Gol 1.0', 1),
  ('M45FD',     'Moura Automotiva',  'Moura', 'Carros pequenos / populares',                 'Fiat Uno, Chevrolet Celta, Ford Ka, VW Gol 1.0', 1),
  ('M60GD',     'Moura Automotiva',  'Moura', 'Carros médios / hatches / sedans',            'Chevrolet Onix, Hyundai HB20, Fiat Argo, Toyota Corolla, Honda Civic', 1),
  ('M60GE',     'Moura Automotiva',  'Moura', 'Carros médios / hatches / sedans',            'Chevrolet Onix, Hyundai HB20, Fiat Argo, Toyota Corolla, Honda Civic', 1),
  ('M60AX',     'Moura EFB',         'Moura', 'Carros médios com Start-Stop',                'VW Polo, VW Nivus, VW T-Cross TSI, Jeep Renegade Flex, Fiat Argo, Fiat Cronos', 1),
  ('M72TX',     'Moura EFB',         'Moura', 'Carros médios com Start-Stop',                'VW Polo, VW Nivus, VW T-Cross TSI, Jeep Renegade Flex, Fiat Argo, Fiat Cronos', 1),
  ('M60AD',     'Moura AGM',         'Moura', 'Luxo / importados com Start-Stop',            'BMW, Mercedes-Benz, Audi, Volvo, Land Rover, VW Jetta, VW Tiguan', 1),
  ('M70LD-AGM', 'Moura AGM',         'Moura', 'Luxo / importados com Start-Stop',            'BMW, Mercedes-Benz, Audi, Volvo, Land Rover, VW Jetta, VW Tiguan', 1),
  ('M92QD',     'Moura AGM',         'Moura', 'Luxo / importados com Start-Stop',            'BMW, Mercedes-Benz, Audi, Volvo, Land Rover, VW Jetta, VW Tiguan', 1),
  ('M70LD',     'Moura Automotiva',  'Moura', 'SUVs médios e pick-ups (flex / diesel leve)', 'Jeep Compass, Chevrolet S10 Flex, Toyota Hilux Flex, Hyundai Tucson', 1),
  ('M75LD',     'Moura Automotiva',  'Moura', 'SUVs médios e pick-ups (flex / diesel leve)', 'Jeep Compass, Chevrolet S10 Flex, Toyota Hilux Flex, Hyundai Tucson', 1),
  ('M90TD',     'Moura Automotiva',  'Moura', 'Vans, furgões e grandes utilitários',         'Renault Master, Fiat Ducato, MB Sprinter, Toyota Hilux Diesel', 1),
  ('M100QD',    'Moura Automotiva',  'Moura', 'Vans, furgões e grandes utilitários',         'Renault Master, Fiat Ducato, MB Sprinter, Toyota Hilux Diesel', 1),
  ('M150BD',    'Moura Log Diesel',  'Moura', 'Caminhões leves e micro-ônibus',              'VW Delivery, Ford Cargo leve, Mercedes-Benz Accelo', 1),
  ('M180BD',    'Moura Log Diesel',  'Moura', 'Caminhões pesados, carretas e ônibus',        'Scania R440, Volvo FH, Mercedes-Benz Axor, Mercedes-Benz Actros', 1),
  ('M220BD',    'Moura Log Diesel',  'Moura', 'Caminhões pesados, carretas e ônibus',        'Scania R440, Volvo FH, Mercedes-Benz Axor, Mercedes-Benz Actros', 1)
on conflict (marca, modelo) do nothing;
