import { relationshipCategoryValues } from "@me-builder/lib";
import * as v from "valibot";

export const RelationshipCategorySchema = v.picklist(relationshipCategoryValues);
