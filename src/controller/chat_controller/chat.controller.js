const { Op, Sequelize } = require("sequelize");
const db = require("../../../config/config");

// Core Models
const Transaction = db.transaction;
const Contract = db.contract;
const Supplier = db.supplier;
const SupplierRating = db.supplier_rating;

// Expanded Modules Models
const IntakeRequest = db.intake_request;
const Department = db.department;
const License = db.license;
const ClientLicense = db.client_license;
const Inventory = db.inventory;
const CostSaving = db.costSaving;
const VolumeDiscount = db.volume_discount;
const RenewalNotification = db.renewal_notification;
const ContractTemplate = db.contract_template;
const MultiYearContracting = db.multi_year_contracting;

const moment = require("moment");

const chatHandler = async (req, res) => {
    try {
        const { human_message } = req.body;
        const userType = req.user?.userType;
        const userId = req.user?.id;
        const isSuperAdmin = userType === 'superadmin';

        // Role-based filtering (where applicable)
        // accessible to user or company-wide depending on model strictness
        const whereClause = isSuperAdmin ? {} : { userId };
        const isGreeting = human_message.toLowerCase().match(/^(hi|hello|hey|greetings)/);

        if (!human_message) {
            return res.status(400).json({ status: false, message: "Message is required" });
        }

        const lowerMessage = human_message.toLowerCase();
        let responseText = "I can help you with Spend, Contracts, Intake, Inventory, Licenses, and more. Try asking specifically about any module!";

        if (isGreeting) {
            return res.status(200).json({
                status: true,
                response: `Hello! I am your ProcXa Assistant. I can analyze data across all your modules. Ask me about "Total Spend", "Open Intake Requests", "Inventory Stock", or "Expiring Licenses".`
            });
        }

        // =====================================================
        // 1. SPEND ANALYTICS (spend, transaction, amount)
        // =====================================================
        if (lowerMessage.includes("spend") || lowerMessage.includes("transaction") || lowerMessage.includes("amount")) {
            const totalSpend = await Transaction.sum('amount', { where: whereClause });
            const transactionCount = await Transaction.count({ where: whereClause });
            const formattedSpend = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSpend || 0);
            responseText = `Total spend is ${formattedSpend} across ${transactionCount} transactions.`;
            if (isSuperAdmin) responseText += " (Company-wide)";
        }

        // =====================================================
        // 2. CONTRACT MANAGEMENT (contract, agreement, expiry)
        // =====================================================
        else if (lowerMessage.includes("contract") || lowerMessage.includes("agreement")) {
            const activeContracts = await Contract.count({ where: { ...whereClause, status: 'Active' } });
            const totalContracts = await Contract.count({ where: whereClause });
            const expiringSoon = await Contract.findAll({
                where: { ...whereClause, endDate: { [Op.between]: [moment().toDate(), moment().add(30, 'days').toDate()] } },
                limit: 3, attributes: ['contractName', 'endDate']
            });
            responseText = `You have ${activeContracts} active contracts out of ${totalContracts} total.`;
            if (expiringSoon.length > 0) {
                const expiringNames = expiringSoon.map(c => `${c.contractName} (${moment(c.endDate).format('MMM D')})`).join(", ");
                responseText += ` Warning: Expiring soon: ${expiringNames}.`;
            }
        }

        // =====================================================
        // 3. RENEWAL MANAGEMENT (renewal, expiring, reminder)
        // =====================================================
        else if (lowerMessage.includes("renewal")) {
            const pendingRenewals = await Contract.findAll({
                where: { ...whereClause, endDate: { [Op.between]: [moment().toDate(), moment().add(90, 'days').toDate()] } },
                limit: 5, attributes: ['contractName', 'endDate']
            });
            if (pendingRenewals.length > 0) {
                const renewalList = pendingRenewals.map(c => `- ${c.contractName} (Due: ${moment(c.endDate).format('MMM D')})`).join("\n");
                responseText = `Upcoming renewals (next 90 days):\n${renewalList}`;
            } else {
                responseText = "No immediate renewals pending for the next 90 days.";
            }
        }

        // =====================================================
        // 4. SUPPLIER PERFORMANCE (supplier, vendor, kpi)
        // =====================================================
        else if (lowerMessage.includes("supplier") || lowerMessage.includes("vendor") || lowerMessage.includes("kpi")) {
            const topSuppliers = await SupplierRating.findAll({
                where: whereClause,
                include: [{ model: Supplier, as: 'supplier', attributes: ['name'] }],
                order: [['averageRating', 'DESC']],
                limit: 3
            });
            const totalSuppliers = await Supplier.count({ where: whereClause });

            if (topSuppliers.length > 0) {
                const supplierList = topSuppliers.map(s => `${s.supplier?.name} (${s.averageRating})`).join(", ");
                responseText = `You have ${totalSuppliers} vendors. Top rated: ${supplierList}.`;
            } else {
                responseText = `You have ${totalSuppliers} registered suppliers. No ratings found yet.`;
            }
        }

        // =====================================================
        // 5. INTAKE MANAGEMENT (intake, request, requisition)
        // =====================================================
        else if (lowerMessage.includes("intake") || lowerMessage.includes("request") || lowerMessage.includes("requisition")) {
            const pendingIntake = await IntakeRequest.count({ where: { ...whereClause, status: 'pending' } }); // Adjust status value as per DB
            const totalIntake = await IntakeRequest.count({ where: whereClause });
            responseText = `There are ${totalIntake} total intake requests. ${pendingIntake} are currently pending approval.`;
        }

        // =====================================================
        // 6. DEPARTMENT MANAGEMENT (department, dept)
        // =====================================================
        else if (lowerMessage.includes("department") || lowerMessage.includes("dept")) {
            // Departments might be company wide usually, but let's check
            // Check if Department model has userId or is generic. Usually generic or by organizationId.
            // Assuming filtered by whereClause if applicable, or just all if generic.
            // For safety, let's try generic count first if whereClause might fail, but config implies it's a standard model.
            // We'll use whereClause if not superadmin generally implies logic.
            // Let's assume departments are User specific OR SuperAdmin managed.
            const totalDepts = await Department.count({ where: whereClause });
            responseText = `You have ${totalDepts} departments configured in the system.`;
        }

        // =====================================================
        // 7. LICENSE MANAGEMENT (license, subscription, seat)
        // =====================================================
        else if (lowerMessage.includes("license") || lowerMessage.includes("subscription")) {
            const totalLicenses = await License.count({ where: whereClause });
            const clientLicenses = await ClientLicense.count({ where: whereClause });
            responseText = `License Overview: ${totalLicenses} internal licenses and ${clientLicenses} third-party/client licenses managed.`;
        }

        // =====================================================
        // 8. INVENTORY MANAGEMENT (inventory, stock, item)
        // =====================================================
        else if (lowerMessage.includes("inventory") || lowerMessage.includes("stock") || lowerMessage.includes("item")) {
            const totalInventory = await Inventory.count({ where: whereClause });
            const lowStock = await Inventory.count({ where: { ...whereClause, quantity: { [Op.lt]: 10 } } }); // Example threshold
            responseText = `Inventory Status: ${totalInventory} items in stock. ${lowStock} items are low on stock (<10).`;
        }

        // =====================================================
        // 9. COST SAVING OPPORTUNITIES (saving, discount)
        // =====================================================
        else if (lowerMessage.includes("saving") || lowerMessage.includes("discount") || lowerMessage.includes("cost")) {
            const totalSavings = await CostSaving.sum('estimatedSavings', { where: whereClause }) || 0;
            const activeDiscounts = await VolumeDiscount.count({ where: whereClause });
            const formattedSavings = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalSavings);
            responseText = `You have identified ${formattedSavings} in potential cost savings. There are ${activeDiscounts} active volume discount opportunities.`;
        }

        // =====================================================
        // 10. RENEWAL NOTIFICATIONS (notification, alert)
        // =====================================================
        else if (lowerMessage.includes("notification") || lowerMessage.includes("alert")) {
            const activeNotifications = await RenewalNotification.count({ where: whereClause });
            responseText = `You have ${activeNotifications} active renewal notifications configured.`;
        }

        // =====================================================
        // 11. CONTRACT TEMPLATES (template, draft)
        // =====================================================
        else if (lowerMessage.includes("template") || lowerMessage.includes("draft")) {
            const totalTemplates = await ContractTemplate.count({ where: whereClause });
            responseText = `There are ${totalTemplates} contract templates available for use.`;
        }

        // =====================================================
        // 12. MULTI-YEAR CONTRACTS (multi-year, long term)
        // =====================================================
        else if (lowerMessage.includes("multi") || lowerMessage.includes("year")) {
            const totalMultiYear = await MultiYearContracting.count({ where: whereClause });
            responseText = `You have ${totalMultiYear} multi-year contracting records.`;
        }


        // Return the response
        return res.status(200).json({
            status: true,
            response: responseText
        });

    } catch (error) {
        console.error("Chatbot Error:", error);
        return res.status(500).json({
            status: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

module.exports = {
    chatHandler
};
