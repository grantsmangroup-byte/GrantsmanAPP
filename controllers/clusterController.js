const Site = require('../models/Site');
const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
const User = require('../models/User');

// @desc    Get all clusters from Site data with stats
// @route   GET /api/clusters
exports.getAllClusters = async (req, res) => {
  try {
    // Aggregate sites by GRATO_Cluster to create cluster data
    const clusterAggregation = await Site.aggregate([
      {
        $match: {
          GRATO_Cluster: { $exists: true, $ne: null, $ne: '' }
        }
      },
      {
        // Group by GRATO_Cluster
        $group: {
          _id: '$GRATO_Cluster',
          region: { $first: '$Region' }, 
          sites: {
            $push: {
              ihsId: '$IHS_ID',
              siteName: '$Site_Name',
              ihsIdSite: '$IHS_ID_SITE',
              priority: '$Sites_Priority',
              siteType: '$Sites_Type',
              tenantsCount: '$Tenants_Count'
            }
          },
          totalSites: { $sum: 1 },
          // Count sites by priority
          highPriority: {
            $sum: {
              $cond: [
                { $eq: ['$Sites_Priority', 'High'] },
                1,
                0
              ]
            }
          },
          mediumPriority: {
            $sum: {
              $cond: [
                { $eq: ['$Sites_Priority', 'Medium'] },
                1,
                0
              ]
            }
          },
          lowPriority: {
            $sum: {
              $cond: [
                { $eq: ['$Sites_Priority', 'Low'] },
                1,
                0
              ]
            }
          },
          // Average tenants count
          avgTenants: { $avg: '$Tenants_Count' }
        }
      },
      {
        // Sort by cluster name
        $sort: { _id: 1 }
      }
    ]);

    // Transform the aggregated data to match your frontend expectations
    const clustersWithStats = clusterAggregation.map(cluster => ({
      _id: cluster._id, // GRATO_Cluster as the cluster ID
      name: cluster._id, // Using cluster name as display name
      description: `Cluster with ${cluster.totalSites} sites`,
      region: cluster.region || 'Unknown',
      towers: cluster.sites.map(site => site.ihsIdSite), // Using IHS_ID_SITE as tower references
      manager: null, // No manager info in Site model
      status: 'active', // Default status
      createdAt: new Date(), // Default date
      updatedAt: new Date(), // Default date
      stats: {
        total_towers: cluster.totalSites,
        active_towers: cluster.totalSites, // Assuming all are active
        total_sites: cluster.totalSites,
        high_priority_sites: cluster.highPriority,
        medium_priority_sites: cluster.mediumPriority,
        low_priority_sites: cluster.lowPriority,
        avg_tenants: Math.round(cluster.avgTenants || 0)
      },
      sites: cluster.sites // Include full site details
    }));

    res.json(clustersWithStats);
  } catch (err) {
    console.error('Error fetching clusters from sites:', err);
    res.status(500).json({ error: 'Server error fetching cluster data' });
  }
};

// @desc    Get single cluster with detailed stats from Site data
// @route   GET /api/clusters/:id
exports.getCluster = async (req, res) => {
  try {
    const clusterId = req.params.id;

    // Find all sites belonging to this cluster
    const sites = await Site.find({ 
      GRATO_Cluster: clusterId 
    }).lean();

    if (sites.length === 0) {
      return res.status(404).json({ error: 'Cluster not found or has no sites' });
    }

    // Calculate detailed stats
    const stats = {
      total_sites: sites.length,
      active_sites: sites.length, // Assuming all are active
      sites_by_type: sites.reduce((acc, site) => {
        const type = site.Sites_Type || 'Unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
      sites_by_priority: sites.reduce((acc, site) => {
        const priority = site.Sites_Priority || 'Unknown';
        acc[priority] = (acc[priority] || 0) + 1;
        return acc;
      }, {}),
      total_tenants: sites.reduce((sum, site) => sum + (site.Tenants_Count || 0), 0),
      avg_tenants: sites.reduce((sum, site) => sum + (site.Tenants_Count || 0), 0) / sites.length,
      regions: [...new Set(sites.map(site => site.Region).filter(Boolean))]
    };

    const clusterData = {
      _id: clusterId,
      name: clusterId,
      description: `Cluster with ${sites.length} sites`,
      region: sites[0]?.Region || 'Unknown',
      towers: sites.map(site => site.IHS_ID_SITE),
      manager: null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      stats,
      sites: sites.map(site => ({
        ihsId: site.IHS_ID,
        siteName: site.Site_Name,
        ihsIdSite: site.IHS_ID_SITE,
        priority: site.Sites_Priority,
        siteType: site.Sites_Type,
        tenantsCount: site.Tenants_Count,
        latitude: site.Latitude,
        longitude: site.Longitude,
        technician: site.Technician_Name,
        technicianContact: site.Technician_Contact
      }))
    };

    res.json(clusterData);
  } catch (err) {
    console.error('Error fetching cluster details:', err);
    res.status(500).json({ error: 'Server error fetching cluster details' });
  }
};

// @desc    Get cluster statistics summary
// @route   GET /api/clusters/stats/summary
exports.getClusterStats = async (req, res) => {
  try {
    const stats = await Site.aggregate([
      {
        $match: {
          GRATO_Cluster: { $exists: true, $ne: null, $ne: '' }
        }
      },
      {
        $group: {
          _id: null,
          totalClusters: { $addToSet: '$GRATO_Cluster' },
          totalSites: { $sum: 1 },
          totalTenants: { $sum: '$Tenants_Count' },
          regionsCount: { $addToSet: '$Region' }
        }
      },
      {
        $project: {
          totalClusters: { $size: '$totalClusters' },
          totalSites: 1,
          totalTenants: 1,
          regionsCount: { $size: '$regionsCount' }
        }
      }
    ]);

    const result = stats[0] || {
      totalClusters: 0,
      totalSites: 0,
      totalTenants: 0,
      regionsCount: 0
    };

    res.json(result);
  } catch (err) {
    console.error('Error fetching cluster statistics:', err);
    res.status(500).json({ error: 'Server error fetching cluster statistics' });
  }
};

// Note: Create, Update, Delete operations would need to be handled differently
// since we're now working with Site data instead of a dedicated Cluster collection
// These operations would involve updating the GRATO_Cluster field in Site documents

exports.createCluster = async (req, res) => {
  res.status(501).json({ 
    error: 'Cluster creation not supported in this mode. Clusters are derived from Site data.' 
  });
};

exports.updateCluster = async (req, res) => {
  res.status(501).json({ 
    error: 'Direct cluster updates not supported. Update individual sites instead.' 
  });
};

exports.deleteCluster = async (req, res) => {
  res.status(501).json({ 
    error: 'Direct cluster deletion not supported. Remove GRATO_Cluster from sites instead.' 
  });
};

exports.addTowerToCluster = async (req, res) => {
  res.status(501).json({ 
    error: 'Use site management to assign sites to clusters via GRATO_Cluster field.' 
  });
};

exports.removeTowerFromCluster = async (req, res) => {
  res.status(501).json({ 
    error: 'Use site management to remove sites from clusters via GRATO_Cluster field.' 
  });
};