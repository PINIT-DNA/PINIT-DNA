# 13 — Class Diagrams

UML-style class diagrams for major modules. TypeScript uses modules/objects more than classical OOP classes; diagrams reflect **exported services, controllers, and Prisma models** as logical classes.

---

## 1. Auth module

```mermaid
classDiagram
  class authController {
    +createAccount()
    +login()
    +refresh()
    +logout()
    +me()
    +setAccountType()
    +setupBusinessWorkspace()
    +businessSetupStatus()
  }
  class authService {
    +createAccount()
    +loginWithId(shortId)
    +refresh(token)
    +logout(token)
    +verifyAccess(token) JwtPayload
  }
  class JwtPayload {
    +sub
    +shortId
    +name
    +role
  }
  class User {
    +id
    +shortId
    +fullName
    +role
    +isActive
  }
  class RefreshToken {
    +token
    +userId
    +expiresAt
  }
  authController --> authService
  authService --> JwtPayload
  authService --> User
  authService --> RefreshToken
```

---

## 2. DNA + Vault

```mermaid
classDiagram
  class DnaRecord {
    +id
    +ownerUserId
    +imageFilename
    +status
    +schemaVersion
  }
  class CryptoLayer
  class StructuralLayer
  class PerceptualLayer
  class SemanticLayer
  class MetadataLayer
  class StegoLayer
  class VaultRecord {
    +id
    +dnaRecordId
    +encryptedFilePath
  }
  class dnaOrchestrator {
    +generate(...)
  }
  class vaultService {
    +store(...)
    +retrieve(...)
    +protectedDownload(...)
  }
  DnaRecord "1" --> "1" CryptoLayer
  DnaRecord "1" --> "1" StructuralLayer
  DnaRecord "1" --> "1" PerceptualLayer
  DnaRecord "1" --> "1" SemanticLayer
  DnaRecord "1" --> "1" MetadataLayer
  DnaRecord "1" --> "1" StegoLayer
  DnaRecord "1" --> "0..1" VaultRecord
  dnaOrchestrator --> DnaRecord
  vaultService --> VaultRecord
```

Additional layer tables (`BehavioralLayer`, `OriginLayer`, …) follow the same 1:1 pattern — see schema.

---

## 3. Share module

```mermaid
classDiagram
  class ShareLink {
    +token
    +ownerUserId
    +filename
    +parentLinkId
    +expiresAt
  }
  class ShareAccessLog {
    +shareLinkId
    +ip
    +createdAt
  }
  class BlockedShareViewer
  class UnmaskRequest
  class shareLinkService {
    +create(...)
    +recordAccess(...)
    +serveFile(...)
    +verifyOtp(...)
  }
  ShareLink "1" --> "*" ShareAccessLog
  ShareLink "1" --> "*" BlockedShareViewer
  ShareLink "1" --> "*" UnmaskRequest
  ShareLink "0..1" --> "0..*" ShareLink : parent/child
  shareLinkService --> ShareLink
```

---

## 4. Subscription + feature guard

```mermaid
classDiagram
  class Plan {
    +code
    +name
  }
  class Subscription {
    +userId
    +planId
    +status
  }
  class FeatureEntitlement {
    +userId
    +featureKey
  }
  class requireFeature {
    +middleware(featureKey)
  }
  class razorpayService {
    +createOrder(...)
    +verifyPayment(...)
  }
  User "1" --> "0..1" Subscription
  Plan "1" --> "*" Subscription
  requireFeature --> FeatureEntitlement
  razorpayService --> Subscription
```

---

## 5. Organization

```mermaid
classDiagram
  class Organization {
    +shortId
    +ownerUserId
  }
  class OrganizationMember {
    +role
  }
  class Workspace
  class Department
  class OrganizationApiKey
  class OrganizationWebhook
  class organizationService {
    +completeSetup(...)
    +inviteMember(...)
  }
  Organization "1" --> "*" OrganizationMember
  Organization "1" --> "*" Workspace
  Organization "1" --> "*" Department
  Organization "1" --> "*" OrganizationApiKey
  Organization "1" --> "*" OrganizationWebhook
  organizationService --> Organization
```

---

## 6. Monitoring / crawler

```mermaid
classDiagram
  class MonitorRecord {
    +dnaRecordId
    +status
    +nextCheckAt
  }
  class CrawlResult
  class CrawlerJob
  class CrawlerMatch
  class monitoringService {
    +enroll(...)
    +kickstartAutoCrawler(...)
  }
  class crawlerEngineService {
    +start()
  }
  MonitorRecord --> CrawlResult
  MonitorRecord --> CrawlerJob
  MonitorRecord --> CrawlerMatch
  monitoringService --> MonitorRecord
  crawlerEngineService --> CrawlerJob
```

---

## 7. Express request pipeline (logical)

```mermaid
classDiagram
  class Request
  class Response
  class requireAuth
  class ownershipMiddleware
  class Controller
  class Service
  class PrismaClient
  requireAuth --> Request : sets user
  ownershipMiddleware --> Request
  Controller --> Service
  Service --> PrismaClient
```

---

## Notes

- Controllers are exported objects of async functions, not ES6 classes — shown as classes for UML clarity.
- Prisma models are the persistent class equivalents.
- Investigation/forensics modules contain many collaborating services (`unified-investigation.orchestrator`, matchers, scorers); treat `src/services/forensics/` as a package with an orchestrator façade rather than one class.
