import { asc } from "drizzle-orm";
import { getDatabase } from "../db/client.js";
import { dashboardModuleCatalog } from "../db/schema.js";

export class DashboardModuleCatalogRepository {
    async list() {
        return getDatabase()
            .select({
                moduleType: dashboardModuleCatalog.moduleType,
                name: dashboardModuleCatalog.name,
                template: dashboardModuleCatalog.template,
            })
            .from(dashboardModuleCatalog)
            .orderBy(asc(dashboardModuleCatalog.sortOrder));
    }
}
