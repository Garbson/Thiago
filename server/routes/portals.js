const express = require("express");
const { pool } = require("../db");
const { authMiddleware } = require("./auth");
const xml2js = require("xml2js");

const router = express.Router();

const PORTALS = [
  { id: "olx", name: "OLX", format: "xml", feedType: "olx" },
  { id: "zapimoveis", name: "ZAP Imóveis", format: "xml", feedType: "zap" },
  { id: "vivareal", name: "Viva Real", format: "xml", feedType: "vivareal" },
  { id: "chavenasmao", name: "Chaves na Mão", format: "xml", feedType: "chavenasmao" },
  { id: "imovelweb", name: "Imóvel Web", format: "xml", feedType: "imovelweb" },
];

// List available portals
router.get("/", authMiddleware, (req, res) => {
  res.json(PORTALS);
});

// Get publish status of a property
router.get("/status/:propertyId", authMiddleware, async (req, res) => {
  try {
    const { propertyId } = req.params;
    const [property] = await pool.query(
      `SELECT published_olx, published_zapimoveis, published_chavenasmao,
              published_vivareal, published_imovelweb
       FROM properties WHERE id = ?`,
      [propertyId]
    );
    if (property.length === 0) {
      return res.status(404).json({ error: "Imóvel não encontrado" });
    }

    const [logs] = await pool.query(
      "SELECT * FROM portal_logs WHERE property_id = ? ORDER BY created_at DESC LIMIT 20",
      [propertyId]
    );

    res.json({ status: property[0], logs });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar status" });
  }
});

// Publish property to a portal
router.post("/publish/:propertyId", authMiddleware, async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { portalId } = req.body;

    if (!portalId) {
      return res.status(400).json({ error: "Portal não informado" });
    }

    const portal = PORTALS.find((p) => p.id === portalId);
    if (!portal) {
      return res.status(400).json({ error: "Portal inválido" });
    }

    const [properties] = await pool.query(
      "SELECT * FROM properties WHERE id = ?",
      [propertyId]
    );
    if (properties.length === 0) {
      return res.status(404).json({ error: "Imóvel não encontrado" });
    }

    const property = properties[0];

    const [images] = await pool.query(
      "SELECT filename FROM property_images WHERE property_id = ? ORDER BY sort_order",
      [propertyId]
    );

    const xmlFeed = generateXMLFeed(property, images, portal);

    // Mark as published
    const col = `published_${portalId}`;
    await pool.query(`UPDATE properties SET \`${col}\` = 1 WHERE id = ?`, [propertyId]);

    await pool.query(
      "INSERT INTO portal_logs (property_id, portal, action, status, response) VALUES (?, ?, ?, ?, ?)",
      [propertyId, portalId, "publish", "success", `Feed XML gerado. ${xmlFeed.length} bytes`]
    );

    res.json({
      message: `Imóvel publicado no ${portal.name}`,
      feedSize: xmlFeed.length,
      feed: xmlFeed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao publicar" });
  }
});

// Unpublish property from a portal
router.post("/unpublish/:propertyId", authMiddleware, async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { portalId } = req.body;

    const col = `published_${portalId}`;
    await pool.query(`UPDATE properties SET \`${col}\` = 0 WHERE id = ?`, [propertyId]);

    await pool.query(
      "INSERT INTO portal_logs (property_id, portal, action, status, response) VALUES (?, ?, ?, ?, ?)",
      [propertyId, portalId, "unpublish", "success", "Imóvel removido do portal"]
    );

    res.json({ message: "Imóvel removido do portal" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao despublicar" });
  }
});

// Publish to ALL portals
router.post("/publish-all/:propertyId", authMiddleware, async (req, res) => {
  try {
    const { propertyId } = req.params;

    const [properties] = await pool.query(
      "SELECT * FROM properties WHERE id = ?",
      [propertyId]
    );
    if (properties.length === 0) {
      return res.status(404).json({ error: "Imóvel não encontrado" });
    }

    await pool.query(
      `UPDATE properties SET
        published_olx = 1, published_zapimoveis = 1,
        published_chavenasmao = 1, published_vivareal = 1,
        published_imovelweb = 1
       WHERE id = ?`,
      [propertyId]
    );

    for (const portal of PORTALS) {
      await pool.query(
        "INSERT INTO portal_logs (property_id, portal, action, status, response) VALUES (?, ?, ?, ?, ?)",
        [propertyId, portal.id, "publish", "success", "Publicado via publish-all"]
      );
    }

    res.json({ message: "Imóvel publicado em todos os portais" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao publicar em todos os portais" });
  }
});

// Generate XML feed endpoint (public, for portals to consume)
router.get("/feed/:portalId", async (req, res) => {
  try {
    const { portalId } = req.params;
    const portal = PORTALS.find((p) => p.id === portalId);
    if (!portal) {
      return res.status(404).send("Portal não encontrado");
    }

    const col = `published_${portalId}`;
    const [properties] = await pool.query(
      `SELECT * FROM properties WHERE active = 1 AND \`${col}\` = 1`
    );

    for (const prop of properties) {
      const [images] = await pool.query(
        "SELECT filename FROM property_images WHERE property_id = ? ORDER BY sort_order",
        [prop.id]
      );
      prop.imageFiles = images;
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const xml = generateFullFeed(properties, portal, baseUrl);

    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao gerar feed");
  }
});

function generateXMLFeed(property, images, portal) {
  const propertyTypeMap = {
    apartamento: "Apartamento",
    casa: "Casa",
    terreno: "Terreno",
    comercial: "Comercial",
    cobertura: "Cobertura",
    studio: "Studio",
    rural: "Rural",
    galpao: "Galpão",
  };

  const transactionMap = {
    venda: "Sale",
    aluguel: "Rental",
    venda_aluguel: "Sale/Rental",
  };

  const listing = {
    ListingID: property.id,
    Title: property.title,
    TransactionType: transactionMap[property.transaction_type] || "Sale",
    PropertyType: propertyTypeMap[property.property_type] || "Apartamento",
    Description: property.description || "",
    ListPrice: property.price,
    LivingArea: property.area,
    Bedrooms: property.bedrooms,
    Bathrooms: property.bathrooms,
    Suites: property.suites,
    Garage: property.parking,
    Furnished: property.furnished ? "Sim" : "Não",
    CondominiumFee: property.condominium_fee,
    PropertyTax: property.iptu,
    Address: {
      Street: property.address || "",
      Neighborhood: property.neighborhood || "",
      City: property.city || "",
      State: property.state || "",
      PostalCode: property.zip_code || "",
      Country: "Brasil",
    },
    Media: {
      Item: images.map((img) => ({
        $: { medium: "image" },
        _: img.filename,
      })),
    },
  };

  const builder = new xml2js.Builder({ rootName: "Listing" });
  return builder.buildObject(listing);
}

function generateFullFeed(properties, portal, baseUrl) {
  const listings = properties.map((prop) => {
    const images = (prop.imageFiles || []).map((img) => ({
      $: { medium: "image" },
      _: `${baseUrl}/uploads/${img.filename}`,
    }));

    return {
      ListingID: prop.id,
      Title: prop.title,
      TransactionType: prop.transaction_type === "aluguel" ? "Rental" : "Sale",
      PropertyType: prop.property_type,
      Description: prop.description || "",
      ListPrice: prop.price,
      LivingArea: prop.area,
      Bedrooms: prop.bedrooms,
      Bathrooms: prop.bathrooms,
      Suites: prop.suites,
      Garage: prop.parking,
      Address: {
        Street: prop.address || "",
        Neighborhood: prop.neighborhood || "",
        City: prop.city || "",
        State: prop.state || "",
        PostalCode: prop.zip_code || "",
      },
      Media: { Item: images },
    };
  });

  const feed = {
    Header: {
      Provider: "Sbruzzi & Carneiro",
      Email: process.env.ADMIN_EMAIL,
      Portal: portal.name,
      PublishDate: new Date().toISOString(),
      TotalListings: properties.length,
    },
    Listings: { Listing: listings },
  };

  const builder = new xml2js.Builder({ rootName: "ListingDataFeed" });
  return builder.buildObject(feed);
}

module.exports = router;
