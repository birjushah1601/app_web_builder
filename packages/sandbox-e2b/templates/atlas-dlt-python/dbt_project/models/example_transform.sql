-- Atlas canonical example transform: select all rows from the dlt-loaded
-- example table. Replace this with real transformation logic
-- (joins, aggregations, window functions, ...).
{{ config(materialized='view') }}

SELECT *
FROM {{ source('raw', 'example') }}
WHERE 1=1
