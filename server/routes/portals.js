const express = require("express");
const path = require("path");
const { pool } = require("../db");
const { authMiddleware } = require("./auth");

const router = express.Router();

// Todos os portais leem a mesma URL de feed no formato VRSync (padrão do
// Grupo OLX). OLX, ZAP e Viva Real são um cadastro só no Canal Pro.
// Chaves na Mão e Imovelweb: a aceitação do VRSync precisa ser confirmada
// com o suporte de cada portal antes de cadastrar a URL.
const PORTALS = [
  { id: "olx", name: "OLX" },
  { id: "zapimoveis", name: "ZAP Imóveis" },
  { id: "vivareal", name: "Viva Real" },
  { id: "chavenasmao", name: "Chaves na Mão" },
  { id: "imovelweb", name: "Imóvel Web" },
];
const PORTAL_IDS = PORTALS.map((p) => p.id);

const PROPERTY_TYPES = {
  apartamento: "Residential / Apartment",
  casa: "Residential / Home",
  terreno: "Residential / Land Lot",
  comercial: "Commercial / Business",
  cobertura: "Residential / Penthouse",
  studio: "Residential / Studio",
  rural: "Residential / Agricultural",
  galpao: "Commercial / Industrial",
};
const COMMERCIAL_TYPES = ["comercial", "galpao"];
// Tipos em que o portal espera área total (LotArea) em vez de área útil.
const LOT_AREA_TYPES = ["terreno", "galpao", "rural"];
// Tipos em que banheiros não são obrigatórios.
const NO_BATHROOM_TYPES = ["terreno", "galpao", "comercial"];
const NO_BEDROOM_TYPES = ["terreno", "galpao", "comercial", "rural"];

const STATES = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia",
  RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe",
  TO: "Tocantins",
};

const MIN_PHOTOS = 5;

function isJpg(filename) {
  return /\.jpe?g$/i.test(filename || "");
}

// Regras de importação do Grupo OLX. Um imóvel com pendências fica fora do
// feed, porque o portal rejeitaria o anúncio.
function validateListing(property, images) {
  const problems = [];
  const title = (property.title || "").trim();
  const description = (property.description || "").trim();
  const type = property.property_type;

  if (title.length < 10 || title.length > 100)
    problems.push("Título precisa ter entre 10 e 100 caracteres");
  if (description.length < 50 || description.length > 3000)
    problems.push("Descrição precisa ter entre 50 e 3000 caracteres");
  if (!(Number(property.price) > 0)) problems.push("Preço não informado");
  if (property.transaction_type === "venda_aluguel")
    problems.push(
      "Venda e aluguel juntos exigem dois preços: cadastre um imóvel para cada finalidade"
    );
  if (!(Number(property.area) > 0)) problems.push("Área não informada");
  if (!(property.zip_code || "").replace(/\D/g, "").match(/^\d{8}$/))
    problems.push("CEP precisa ter 8 dígitos");
  if (!property.city) problems.push("Cidade não informada");
  if (!property.neighborhood) problems.push("Bairro não informado");
  if (!STATES[(property.state || "").toUpperCase()])
    problems.push("Estado (UF) inválido");
  if (!NO_BATHROOM_TYPES.includes(type) && !(Number(property.bathrooms) > 0))
    problems.push("Número de banheiros é obrigatório para este tipo");
  if (
    !NO_BEDROOM_TYPES.includes(type) &&
    type !== "studio" &&
    !(Number(property.bedrooms) > 0)
  )
    problems.push("Número de quartos é obrigatório para este tipo");

  const jpgs = images.filter((img) => isJpg(img.filename));
  if (jpgs.length < MIN_PHOTOS)
    problems.push(
      `São necessárias pelo menos ${MIN_PHOTOS} fotos em JPG (este imóvel tem ${jpgs.length}); PNG e WebP não são importados`
    );
  return problems;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cdata(value) {
  return `<![CDATA[${String(value ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function int(value) {
  return Math.round(Number(value) || 0);
}

function publicUrl(req) {
  return (
    process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`
  ).replace(/\/+$/, "");
}

function listingXml(prop, images, baseUrl) {
  const type = prop.property_type;
  const uf = (prop.state || "").toUpperCase();
  const isRent = prop.transaction_type === "aluguel";
  const jpgs = images.filter((img) => isJpg(img.filename));

  const media = jpgs
    .map(
      (img, i) =>
        `        <Item medium="image"${i === 0 ? ' primary="true"' : ""}>${esc(
          `${baseUrl}/uploads/${encodeURIComponent(path.basename(img.filename))}`
        )}</Item>`
    )
    .join("\n");

  const details = [
    `<UsageType>${COMMERCIAL_TYPES.includes(type) ? "Commercial" : "Residential"}</UsageType>`,
    `<PropertyType>${PROPERTY_TYPES[type] || PROPERTY_TYPES.apartamento}</PropertyType>`,
    `<Description>${cdata(prop.description.trim())}</Description>`,
    isRent
      ? `<RentalPrice currency="BRL" period="Monthly">${int(prop.price)}</RentalPrice>`
      : `<ListPrice currency="BRL">${int(prop.price)}</ListPrice>`,
  ];
  if (Number(prop.condominium_fee) > 0)
    details.push(
      `<PropertyAdministrationFee currency="BRL">${int(prop.condominium_fee)}</PropertyAdministrationFee>`
    );
  if (Number(prop.iptu) > 0)
    details.push(`<YearlyTax currency="BRL">${int(prop.iptu)}</YearlyTax>`);
  details.push(
    LOT_AREA_TYPES.includes(type)
      ? `<LotArea unit="square metres">${int(prop.area)}</LotArea>`
      : `<LivingArea unit="square metres">${int(prop.area)}</LivingArea>`
  );
  if (!NO_BEDROOM_TYPES.includes(type))
    details.push(`<Bedrooms>${int(prop.bedrooms)}</Bedrooms>`);
  if (Number(prop.bathrooms) > 0)
    details.push(`<Bathrooms>${int(prop.bathrooms)}</Bathrooms>`);
  if (Number(prop.suites) > 0) details.push(`<Suites>${int(prop.suites)}</Suites>`);
  if (Number(prop.parking) > 0)
    details.push(`<Garage type="Parking Space">${int(prop.parking)}</Garage>`);

  const location = [
    `<Country abbreviation="BR">Brasil</Country>`,
    `<State abbreviation="${esc(uf)}">${cdata(STATES[uf])}</State>`,
    `<City>${cdata(prop.city)}</City>`,
    `<Neighborhood>${cdata(prop.neighborhood)}</Neighborhood>`,
  ];
  if (prop.address) location.push(`<Address>${cdata(prop.address)}</Address>`);
  location.push(
    `<PostalCode>${prop.zip_code.replace(/\D/g, "")}</PostalCode>`
  );

  const contact = [`<Name>${cdata(process.env.COMPANY_NAME || "Carneiro & Chiaradia")}</Name>`];
  contact.push(
    `<Email>${esc(process.env.CONTACT_EMAIL || process.env.ADMIN_EMAIL || "")}</Email>`
  );
  contact.push(`<Website>${esc(baseUrl)}</Website>`);
  if (process.env.CONTACT_PHONE)
    contact.push(`<Telephone>${esc(process.env.CONTACT_PHONE)}</Telephone>`);

  return `    <Listing>
      <ListingID>${prop.id}</ListingID>
      <Title>${cdata(prop.title.trim())}</Title>
      <TransactionType>${isRent ? "For Rent" : "For Sale"}</TransactionType>
      <PublicationType>STANDARD</PublicationType>
      <DetailViewUrl>${esc(`${baseUrl}/?imovel=${prop.id}`)}</DetailViewUrl>
      <Media>
${media}
      </Media>
      <Details>
        ${details.join("\n        ")}
      </Details>
      <Location displayAddress="Neighborhood">
        ${location.join("\n        ")}
      </Location>
      <ContactInfo>
        ${contact.join("\n        ")}
      </ContactInfo>
    </Listing>`;
}

function feedXml(listings, baseUrl) {
  const header = [
    `<Provider>${cdata(process.env.COMPANY_NAME || "Carneiro & Chiaradia")}</Provider>`,
    `<Email>${esc(process.env.CONTACT_EMAIL || process.env.ADMIN_EMAIL || "")}</Email>`,
    `<ContactName>${cdata(process.env.CONTACT_NAME || "Carneiro & Chiaradia")}</ContactName>`,
    `<PublishDate>${new Date().toISOString().slice(0, 19)}</PublishDate>`,
  ];
  if (process.env.CONTACT_PHONE)
    header.push(`<Telephone>${esc(process.env.CONTACT_PHONE)}</Telephone>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd">
  <Header>
    ${header.join("\n    ")}
  </Header>
  <Listings>
${listings.map(({ prop, images }) => listingXml(prop, images, baseUrl)).join("\n")}
  </Listings>
</ListingDataFeed>
`;
}

async function loadImages(propertyId) {
  const [images] = await pool.query(
    "SELECT filename FROM property_images WHERE property_id = ? ORDER BY sort_order",
    [propertyId]
  );
  return images;
}

async function loadProperty(propertyId) {
  const [rows] = await pool.query("SELECT * FROM properties WHERE id = ?", [
    propertyId,
  ]);
  return rows[0] || null;
}

async function log(propertyId, portalId, action, status, response) {
  await pool.query(
    "INSERT INTO portal_logs (property_id, portal, action, status, response) VALUES (?, ?, ?, ?, ?)",
    [propertyId, portalId, action, status, response]
  );
}

router.get("/", authMiddleware, (req, res) => {
  res.json(
    PORTALS.map((p) => ({
      ...p,
      feedUrl: `${publicUrl(req)}/api/portals/feed/${p.id}`,
    }))
  );
});

router.get("/status/:propertyId", authMiddleware, async (req, res) => {
  try {
    const property = await loadProperty(req.params.propertyId);
    if (!property) return res.status(404).json({ error: "Imóvel não encontrado" });

    const images = await loadImages(property.id);
    const [logs] = await pool.query(
      "SELECT * FROM portal_logs WHERE property_id = ? ORDER BY created_at DESC LIMIT 20",
      [property.id]
    );
    const status = {};
    for (const id of PORTAL_IDS) status[`published_${id}`] = property[`published_${id}`];

    res.json({ status, problems: validateListing(property, images), logs });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar status" });
  }
});

async function publish(req, res, portalIds) {
  const property = await loadProperty(req.params.propertyId);
  if (!property) return res.status(404).json({ error: "Imóvel não encontrado" });

  const problems = validateListing(property, await loadImages(property.id));
  if (problems.length) {
    return res.status(422).json({
      error: "Imóvel ainda não pode ir para os portais: " + problems.join("; "),
      problems,
    });
  }

  const sets = portalIds.map((id) => `\`published_${id}\` = 1`).join(", ");
  await pool.query(`UPDATE properties SET ${sets} WHERE id = ?`, [property.id]);
  for (const id of portalIds)
    await log(property.id, id, "publish", "success", "Incluído no feed XML");

  res.json({
    message:
      "Imóvel incluído no feed. O portal lê o feed nos horários dele (Grupo OLX: a cada 12 horas).",
  });
}

router.post("/publish/:propertyId", authMiddleware, async (req, res) => {
  try {
    const { portalId } = req.body;
    if (!PORTAL_IDS.includes(portalId))
      return res.status(400).json({ error: "Portal inválido" });
    await publish(req, res, [portalId]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao publicar" });
  }
});

router.post("/publish-all/:propertyId", authMiddleware, async (req, res) => {
  try {
    await publish(req, res, PORTAL_IDS);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao publicar em todos os portais" });
  }
});

router.post("/unpublish/:propertyId", authMiddleware, async (req, res) => {
  try {
    const { portalId } = req.body;
    if (!PORTAL_IDS.includes(portalId))
      return res.status(400).json({ error: "Portal inválido" });

    await pool.query(
      `UPDATE properties SET \`published_${portalId}\` = 0 WHERE id = ?`,
      [req.params.propertyId]
    );
    await log(req.params.propertyId, portalId, "unpublish", "success", "Removido do feed XML");
    res.json({ message: "Imóvel removido do feed do portal" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao despublicar" });
  }
});

// Feed público: é esta URL que se cadastra no painel de cada portal.
router.get("/feed/:portalId", async (req, res) => {
  try {
    const { portalId } = req.params;
    if (!PORTAL_IDS.includes(portalId))
      return res.status(404).send("Portal não encontrado");

    const [properties] = await pool.query(
      `SELECT * FROM properties WHERE active = 1 AND \`published_${portalId}\` = 1 ORDER BY id`
    );

    const listings = [];
    for (const prop of properties) {
      const images = await loadImages(prop.id);
      if (validateListing(prop, images).length === 0)
        listings.push({ prop, images });
    }

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.send(feedXml(listings, publicUrl(req)));
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao gerar feed");
  }
});

module.exports = router;
module.exports.validateListing = validateListing;
module.exports.feedXml = feedXml;
