import logging
from typing import Optional, Dict, Any, List
from bson.objectid import ObjectId

from .database import mongo_client
from .config import Config

logger = logging.getLogger("uvicorn")

class BaseRepository:
    """Base repository class providing common MongoDB CRUD operations to abstract direct database logic out of routers."""
    
    def __init__(self, collection_name: str):
        self.collection_name = collection_name
        self._collection = None

    @property
    def collection(self):
        if self._collection is None:
            if mongo_client:
                self._collection = mongo_client[Config.DB_NAME][self.collection_name]
        return self._collection

    def find_all(self, query: Dict[str, Any] = None, limit: int = 50, sort: List[tuple] = None) -> List[Dict[str, Any]]:
        if not self.collection:
            return []
        cursor = self.collection.find(query or {})
        if sort:
            cursor = cursor.sort(sort)
        if limit > 0:
            cursor = cursor.limit(limit)
        return list(cursor)

    def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.collection:
            return None
        return self.collection.find_one(query)

    def find_by_id(self, document_id: str) -> Optional[Dict[str, Any]]:
        try:
            return self.find_one({"_id": ObjectId(document_id)})
        except Exception:
            return None

    def insert_one(self, document: Dict[str, Any]) -> Optional[str]:
        if not self.collection:
            return None
        result = self.collection.insert_one(document)
        return str(result.inserted_id)

    def update_by_id(self, document_id: str, update_data: Dict[str, Any]) -> bool:
        if not self.collection:
            return False
        try:
            result = self.collection.update_one(
                {"_id": ObjectId(document_id)},
                {"$set": update_data}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating {self.collection_name}: {e}")
            return False

    def delete_by_id(self, document_id: str) -> bool:
        if not self.collection:
            return False
        try:
            result = self.collection.delete_one({"_id": ObjectId(document_id)})
            return result.deleted_count > 0
        except Exception as e:
            logger.error(f"Error deleting {self.collection_name}: {e}")
            return False
