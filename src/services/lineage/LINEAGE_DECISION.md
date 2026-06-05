# Lineage Architecture Decision

## Decision: Keep PostgreSQL, NOT Neo4j

### Reason
The `DocumentLineage` table in PostgreSQL fully satisfies Step 7 requirements:
- Parent-child document relationships ✅
- Version tracking ✅  
- Modification history ✅
- Duplicate cluster detection ✅
- GET /intelligence/lineage/:id endpoint ✅
- GET /intelligence/duplicates endpoint ✅

### Why NOT Neo4j
- Requires additional Docker container or Java install
- Increases deployment complexity (client-grade product needs minimal dependencies)
- PostgreSQL lineage queries perform well up to millions of records
- No graph-specific traversal queries required by the spec

### If Neo4j is Required Later
- Install: `npm install neo4j-driver`
- Run: `docker run -p 7687:7687 neo4j`
- Migration: export DocumentLineage to Cypher CREATE statements
