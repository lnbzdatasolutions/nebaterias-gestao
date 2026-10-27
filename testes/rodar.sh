#!/usr/bin/env bash
# Recria o banco de teste local e roda todos os cenários.
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists loja_teste" -c "create database loja_teste"
psql -q -v ON_ERROR_STOP=1 -d loja_teste -f testes/00_simular_supabase.sql -f supabase/schema.sql -f supabase/seed.sql
psql -d loja_teste -v ON_ERROR_STOP=1 -f testes/01_cenarios.sql
psql -q -v ON_ERROR_STOP=1 -d loja_teste -f supabase/migracoes/002_notas_fiscais.sql
psql -d loja_teste -v ON_ERROR_STOP=1 -f testes/02_notas_fiscais.sql
