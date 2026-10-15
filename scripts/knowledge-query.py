"""Run bounded, read-only queries against the configured Construct knowledge index."""

import json
import re
import sqlite3
import sys
from pathlib import Path


def source(db, identity):
    row = db.execute("SELECT url,sha256,license FROM sources WHERE id=?", (identity,)).fetchone()
    if not row:
        return {"id": identity, "coverage": "Source provenance is unavailable"}
    match = re.search(r"/r(\d+)(?:-(\d+))?/", row["url"] or "")
    return {"id": identity, "url": row["url"], "hash": row["sha256"], "license": row["license"],
            "release": (f"r{match[1]}" + (f".{match[2]}" if match[2] else "")) if match else "unknown"}


def contract_source(db, owner_type):
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ace_sources'").fetchone():
        row = db.execute("SELECT source_id FROM ace_sources WHERE owner_type=?", (owner_type,)).fetchone()
        if not row:
            raise ValueError(f"Contract source mapping unavailable for {owner_type}")
        result = source(db, row[0])
        if not result.get('url') or not result.get('hash'):
            raise ValueError(f"Contract source provenance unavailable for {owner_type}")
        return result
    return source(db, {"plugin": "plugins-allAces-r495-2", "behavior": "behaviors-allAces-r495-2",
                       "common": "common-aces-r495-2"}[owner_type])


def contract(db, request):
    owner_type, owner = request["ownerType"], request["owner"]
    if owner == "System":
        owner = "system"
    kind, identity = request["kind"], request["id"]
    assert owner_type in ("plugin", "behavior", "common")
    assert kind in ("actions", "conditions", "expressions")
    row = db.execute("SELECT definition FROM aces WHERE owner_type=? AND owner=? AND kind=? AND id=?",
                     (owner_type, owner, kind, identity)).fetchone()
    if row:
        return {"status": "verified", "definition": json.loads(row[0]), "evidence": "public-editor-contract",
                "source": contract_source(db, owner_type), "applicability": "Unassigned" if owner_type == "common" else "Direct owner contract"}
    known = bool(db.execute("SELECT 1 FROM aces WHERE owner_type=? AND owner=? LIMIT 1", (owner_type, owner)).fetchone())
    if owner_type == "plugin":
        common = db.execute("SELECT definition FROM aces WHERE owner_type='common' AND owner='builtin' AND kind=? AND id=?", (kind, identity)).fetchone()
        observed = db.execute("SELECT 1 FROM observed_aces WHERE owner_type='plugin' AND lower(owner)=lower(?) AND kind=? AND id=?", (owner, kind, identity)).fetchone()
        if common and observed:
            return {"status": "verified", "definition": json.loads(common[0]), "evidence": "common-contract-with-observed-owner",
                    "source": contract_source(db, "common"), "coverage": "Owner applicability observed in an original project; not universal plugin coverage"}
        return {"status": "unverified", "knownOwner": known, "reason": "No verified direct contract or observed common applicability; investigate the knowledge gap before writing."}
    return {"status": "not-found" if known else "unverified", "knownOwner": known,
            "reason": "ACE absent from the known owner contract" if known else "Owner contract is unavailable"}


def query(db, request):
    operation = request["operation"]
    if operation == "get_ace_contract":
        return contract(db, request)
    limit = request.get("limit", 5)
    if type(limit) is not int or not 1 <= limit <= 10:
        raise ValueError("Result limit must be an integer from 1 to 10")
    text = request.get("query", "")
    if not isinstance(text, str) or len(text) > 250:
        raise ValueError("Query must be a string of at most 250 characters")
    if operation == "search_docs":
        rows = db.execute("""SELECT p.id,p.source,p.page,p.title,p.url,substr(snippet(page_search,2,'','',' … ',64),1,1800) AS text
            FROM page_search JOIN pages p ON p.id=page_search.id
            WHERE page_search MATCH ? ORDER BY bm25(page_search) LIMIT ?""", (text, limit)).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["sourceHash"] = source(db, row["source"]).get("hash")
            item["evidence"] = "official-manual-extraction"
            results.append(item)
        return {"results": results, "coverage": "Downloaded manual snapshot; verify version-sensitive behavior against the installed release"}
    if operation == "search_examples":
        results = []
        addon = request.get("addonId")
        for row in db.execute("SELECT slug,metadata FROM examples ORDER BY slug"):
            metadata = json.loads(row["metadata"])
            tags = metadata.get("catalog", {}).get("tags", [])
            addons = metadata.get("addons", [])
            searchable = " ".join([row["slug"], metadata.get("name", ""), *tags, *[a["id"] for a in addons]]).lower()
            if any(word not in searchable for word in text.lower().split()):
                continue
            if addon and not any(a["id"] == addon for a in addons):
                continue
            results.append({"slug": row["slug"], "name": metadata.get("name"), "tags": tags, "addons": addons,
                            "sourceHash": metadata.get("sha256Tree"), "savedWithRelease": metadata.get("savedWithRelease"),
                            "status": metadata.get("status", {"structuralScan": "unknown", "semanticReview": "unknown", "editorOpen": "unknown", "runtimeTest": "unknown"}),
                            "url": metadata.get("catalog", {}).get("projectUrl") or "https://github.com/Scirra/Construct-Example-Projects/tree/main/example-projects/" + row["slug"],
                            "license": "Consult the source license; original assets remain local"})
            if len(results) == limit:
                break
        return {"results": results, "evidence": "structural-inventory-and-official-catalog"}
    raise ValueError("Unknown knowledge query operation")


try:
    raw = sys.stdin.read(65_537)
    if len(raw.encode()) > 65_536:
        raise ValueError("Request exceeds 64 KiB")
    request = json.loads(raw)
    path = Path(sys.argv[1]).resolve()
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        print(json.dumps(query(db, request)))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
