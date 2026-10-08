-- Files saved before document-type checks stay DOCUMENT_UPLOADED and are not listed as on file.

ALTER TABLE "government_id_records" ADD COLUMN "documentState" TEXT NOT NULL DEFAULT 'DOCUMENT_UPLOADED';
