Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    CHUNK_SIZE: 10,
    items: [
        {xtype:'container',itemId:'criteria_box', layout: {type: 'hbox'}, padding: 10},
        {xtype:'container',itemId:'display_box'},
        {xtype:'tsinfolink'}
    ],
    portfolioItemType: 'PortfolioItem/Feature',
    portfolioItemFilterField: 'c_FeatureType',
    portfolioItemTypeFetchFields: ['ObjectID','FormattedID','Name','State','c_FeatureTargetSprint','c_FeatureDeploymentType','c_CodeDeploymentSchedule','Owner','LeafStoryPlanEstimateTotal'],
    userStoryFetchFields: ['ObjectID','ScheduleState','FormattedID','Name','Feature','PlanEstimate','Iteration','Name','Owner'],
    unscheduledFieldName: 'Unscheduled',
    outsideReleaseFieldName: 'OutsideRelease',
    launch: function() {

        this.cbRelease = this.down('#criteria_box').add({
            xtype:'rallyreleasecombobox',
            fieldLabel: 'Release',
            labelAlign: 'right',
            stateful: true,
            stateId: this.getContext().getScopedStateId('cb-release'),
            width: 350,
            storeConfig: {
                context: {projectScopeDown: false}
            },
            margin: 10
        }); 
        
        var ff_label = this.portfolioItemFilterField.replace(/^c_/,"");
        this.cbFeatureFilter = this.down('#criteria_box').add({
            xtype: 'rallyfieldvaluecombobox',
            model: this.portfolioItemType,
            field: this.portfolioItemFilterField,
            fieldLabel: ff_label,
            labelAlign: 'right',
            stateful: true,
            stateId: this.getContext().getScopedStateId('cb-feature'),
            forceSelection: false,
            allowNoEntry: true,
            margin: 10
        });
        
        this.down('#criteria_box').add({
            xtype: 'rallybutton',
            itemId: 'btn-apply',
            text: 'Apply',
            scope: this,
            handler: this._run,
            margin: 10
        });
        
        this.down('#criteria_box').add({
            xtype: 'rallybutton',
            text: 'Export',
            itemId: 'btn-export',
            scope: this,
            handler: this._export,
            disabled: true,
            margin: 10
        });
    },
    _export: function(){
        var file_name = 'portfolio-planning-view-export.csv';
        var tree_grid = this.down('#feature-tree');
        var featureNodes = tree_grid.getStore().getRootNode().childNodes;
        var model = tree_grid.getStore().model;
        this.logger.log('_export tree_store',model.getFields(),featureNodes);

        var column_keys = [];
        var text = 'Feature,User Story,ScheduleState,Owner,';
        Ext.each(Object.keys(this.iterationMap), function(key){
            text += this.iterationMap[key] + ',';
            column_keys.push(key);
        },this);
        text = text.replace(/,$/,'\n');

        //This assumes one level of children under each feature.  If there are nested children, they will only show with the feature,
        //but not their parents in the flattened structure
        Ext.each(featureNodes, function(feature){
            var owner = feature.get('Owner') || {};
            text += Ext.String.format("\"{0}\",,,\"{1}\",", this._getFeatureText(feature,true),owner._refObjectName || '');
            Ext.each(column_keys, function(key){
                text += feature.get(key) + ',';
            },this);
            text = text.replace(/,$/,'\n');

            text += this._exportChildNodes(feature, feature,column_keys);
        },this);
        Rally.technicalservices.FileUtilities.saveTextAsFile(text, file_name);
    },
    _exportChildNodes: function(feature, parent_node,column_keys){
        var text = '';
        if (parent_node.childNodes.length == 0){
            return text;
        }
        Ext.each(parent_node.childNodes, function(child){
            var owner = child.get('Owner') || {};

                text += Ext.String.format('"",\"{0}\",{1},\"{2}\",',this._getStoryText(child, true),child.get('ScheduleState'),owner._refObjectName || '');
                Ext.each(column_keys, function(key){
                    text += child.get(key) + ',';
                },this);
                text = text.replace(/,$/,'\n');
                //text += this._exportChildNodes(feature, child, column_keys);
        },this);
        return text;  
    },
    _readyWindow: function(disable, success){
        this.setLoading(disable);
        this.down('#btn-apply').setDisabled(disable);
        this.down('#btn-export').setDisabled(disable || !success);
    },
    _run: function(){
        var release_filter = this.cbRelease.getQueryFromSelected();
        var feature_filter = this.cbFeatureFilter.getValue();
        this.logger.log('_run: release_filter', release_filter.toString(), 'feature_filter', feature_filter,this.cbRelease.getRecord().get('ReleaseStartDate'));
        
        this._readyWindow(true, false);  
        
        var release_start_date = this.cbRelease.getRecord().get('ReleaseStartDate');
        var release_end_date = this.cbRelease.getRecord().get('ReleaseDate');
        var releaseName = this.cbRelease.getRecord().get('Name');
        
        this._fetchPortfolioItems(release_filter, feature_filter).then({
            scope: this,
            success: function(pi_data){
                this.logger.log('fetchPortfolioItems success', pi_data);
                this._fetchUserStories(pi_data).then({
                    scope: this,
                    success: function(user_story_data){
                        this.logger.log('fetchUserStories success', user_story_data);
                        this._fetchIterations(release_start_date, release_end_date, releaseName, this.unscheduledFieldName, this.outsideReleaseFieldName).then({
                            scope: this,
                            success: function(){
                                this.logger.log('_fetchIterations', this.iterationMap);
                                var columns = this._constructColumns();
                                
                                var inputData = [pi_data, user_story_data];
                                var root = this.buildRoot(this._getPortfolioItemFieldName(),inputData,this.unscheduledFieldName,this.outsideReleaseFieldName);
                                    
                                var model_fields = [];
                                model_fields.push({name: 'ObjectID'});
                                model_fields.push({name: 'FormattedID'});
                                model_fields.push({name: 'Name'});
                                model_fields.push({name: 'ScheduleState'});
                                model_fields.push({name: 'c_CodeDeploymentSchedule'});
                                model_fields.push({name: 'c_FeatureTargetSprint'});
                                model_fields.push({name: 'c_FeatureDeploymentType'});
                                model_fields.push({name: 'Owner'});
                                model_fields.push({name: 'LeafStoryPlanEstimateTotal'});
                                model_fields.push({name: 'State'});
                                Ext.each(Object.keys(this.iterationMap), function(key){
                                    model_fields.push({name: key});
                                });
                                model_fields.push({name: this.unscheduledFieldName});
                                model_fields.push({name: this.outsideReleaseFieldName});
                                
                                Ext.define('IterationTreeModel', {
                                    extend: 'Ext.data.Model',
                                    fields: model_fields
                                });

                                var treeStore = Ext.create('Ext.data.TreeStore',{
                                    model: IterationTreeModel,
                                    root: {expanded: true, children: root}
                                });
                                this._createTree(treeStore, columns);
                                this._readyWindow(false, true);  
                            },
                            failure: function(error){
                                this.logger.log('_fetchIterations return error', error);
                                this._readyWindow(false, false);  
                            }
                        });
                    },
                    failure: function(error){
                        this.logger.log('_fetchUserStories return error',error);
                        this._readyWindow(false, false);  
                    }
                });
            },
            failure: function(error){
                this.logger.log('_fetchPortfolioItems return error',error);
                this._readyWindow(false, false);  
            }
        });
    },
    _fetchPortfolioItems: function(release_filter, feature_filter){
        var deferred = Ext.create('Deft.Deferred');

        var filters = release_filter;  
        if (feature_filter){
            filters = filters.and(Ext.create('Rally.data.wsapi.Filter',{
                property: this.portfolioItemFilterField,
                value: feature_filter
            }));
        }
        this.logger.log('_fetchPortfolioItems',filters.toString());
        this._createWsapiStore(this.portfolioItemType, this.portfolioItemTypeFetchFields, filters).then({
            scope: this,
            success: function(data){
                deferred.resolve(data);
            },
            failure: function(error){
                this.logger.log('_fetchPortfolioItems _createStore failed', error);
            }
        });
        return deferred;  
    },
    _getPortfolioItemFieldName: function(){
        return 'Feature';
    },
    _fetchUserStories: function(portfolio_items_data){
        this.logger.log('_fetchUserStories', portfolio_items_data);
        var deferred = Ext.create('Deft.Deferred');
        
        if (portfolio_items_data.length == 0){
            deferred.resolve([]);
        }
        
        var pi_ancestor_field_name = this._getPortfolioItemFieldName() + '.ObjectID';
        var filters = []; 
        var idx = -1;
        var counter = 0;
        Ext.each(portfolio_items_data, function(pi){
            var filter = Ext.create('Rally.data.wsapi.Filter',{
                property: pi_ancestor_field_name,
                value: pi.get('ObjectID')
            });
            if (counter % this.CHUNK_SIZE == 0){
                if (idx >= 0) {this.logger.log('_fetchUserStories: filter', filters[idx].toString())};
                idx++;
                filters[idx] = filter;  
            } else {
                filters[idx] = filters[idx].or(filter);
            }
            counter++;
        },this);
        
        var promises = [];
        Ext.each(filters, function(f){
            promises.push(this._createWsapiStore('HierarchicalRequirement',this.userStoryFetchFields, f));
        },this);

        var projectName = this.getContext().getProject().Name;
        var tagFilter = [{property: 'Tags.Name', operator: 'contains', value: 'Issuer: ' + projectName}];
        promises.push(this._createWsapiStore('HierarchicalRequirement',this.userStoryFetchFields, tagFilter, null, {project: null}));

        Deft.Promise.all(promises).then({
            scope:this,
            success: function(data){
                var user_story_data = _.flatten(data);
                this.logger.log('_fetchUserStories Promise complete:',data, user_story_data.length);
                deferred.resolve(user_story_data);
            },
            failure: function(error){
                this.logger.log('_fetchUserStories Promise failed', error);
            }
        });
        return deferred;
    },
    _fetchIterations: function(releaseStartDate, releaseEndDate, releaseName, unscheduledFieldName, outsideReleaseFieldName){
        var deferred = Ext.create('Deft.Deferred');
        /* Filter only by iteration name */
        var filters = Ext.create('Rally.data.wsapi.Filter',{
            property: 'StartDate',
            operator: '<',
            value: Rally.util.DateTime.toIsoString(new Date(releaseEndDate))
        });
        filters = filters.and(Ext.create('Rally.data.wsapi.Filter',{
            property: 'EndDate',
            operator: '>',
            value: Rally.util.DateTime.toIsoString(new Date(releaseStartDate))
        }));
        //filters = filters.and(Ext.create('Rally.data.wsapi.Filter',{
        //    var filters = Ext.create('Rally.data.wsapi.Filter',{
        //        property: 'Name',
        //        operator: 'contains',
        //        value: this._getIterationNameFilter(releaseName)
        //    });

        var sorter = [{
                property: 'StartDate',
                direction: 'ASC'
        }];
        var context = {projectScopeDown: false};
        this.logger.log('_fetchIterations',filters.toString(),sorter);
        var fetch = ['Name','StartDate','EndDate','ObjectID'];
        this._createWsapiStore('Iteration',fetch, filters, sorter, context).then({
            scope: this,
            success: function(data){
                this.iterationMap = {};
                Ext.each(data, function(d){
                    var iteration = 'I' + d.get('ObjectID');
                    this.iterationMap[iteration] = d.get('Name');
                },this);
                deferred.resolve();
            },
            failure: function(error){
                deferred.reject('Error fetching Iterations: ' + error);
            }
        });
        return deferred; 
    },
    _createWsapiStore: function(model, fetch, filter,sorter,context){
        this.logger.log('_createWsapiStore',model, fetch,filter.toString());
        if (sorter == undefined){
            sorter=[{property: 'ObjectID', direction: 'ASC'}];
        }
        if (context == undefined){
            context = {};
        }
        var deferred = Ext.create('Deft.Deferred');
        Ext.create('Rally.data.wsapi.Store',{
            model: model,
            fetch: fetch,
            autoLoad: true,
            filters: filter,
            sorter: sorter,
            context: context,
            limit: 'Infinity',
            listeners: {
                scope: this,
                load: function(store,data,success){
                    this.logger.log('_createWsapiStore: Store loaded',store,success);
                    if (success){
                        deferred.resolve(data);
                    } else {
                        deferred.reject('Store failed to load.', model, fetch, filter.toString());
                    }
                }
            }
        });
        return deferred;
    },
    
    _createTree: function(tree_store, columns){
            
            if (this.down('#feature-tree')){
                this.down('#feature-tree').destroy();
            }
        
            var tree = this.add({
            xtype:'treepanel',
            itemId: 'feature-tree',
            store: tree_store,
            cls: 'rally-grid',
            rootVisible: false,
            rowLines: true,
                split: true,
            height: this.height,
            columns: columns
        });
    },
    _artifactRenderer: function(v,m,r){
        var text = r.get('Name');
        if (v && v.length > 0){
            if (r.getDepth() == 1){
                m.tdCls = "feature";
                text = this._getFeatureText(r);
            } else {
                text = this._getStoryText(r);
            }
        } else {
            m.tdCls = "total";
        }
        return text;
    },
    _getFeatureText: function(feature, withoutHtml){
         var text = '';

        if (!feature.get('FormattedID')){
            return feature.get('Name');
        }

        if (withoutHtml && feature && feature.get('FormattedID')){
            text = feature.get('FormattedID') + ": " + feature.get('Name');
        } else {
            var storyPoints = feature.get('LeafStoryPlanEstimateTotal');
            var storyPointsInRelease = 0;
            Ext.each(Object.keys(this.iterationMap),function(key){
                storyPointsInRelease += feature.get(key);
            });
            var urlText = Ext.String.format("/{0}/{1}","portfolioitem/feature", feature.get('ObjectID'));
            var url = Rally.nav.Manager.getDetailUrl(urlText);
            text = Ext.String.format('<a href="{0}" target="_blank"><b>{1}</b></a>',url, feature.get('FormattedID'));
            text += ": " + feature.get('Name');
            text = Ext.String.format("<br/>{0}<br/>Feature Target Sprint: <b>{1}</b><br/>Feature Deployment Type: <b>{2}</b><br/>Code Deployment Schedule: <b>{3}</b><br/>Story Points (Release/Total): <b>{4} / {5}</b>",
                text,
                feature.get('c_FeatureTargetSprint'),
                feature.get('c_FeatureDeploymentType'),
                feature.get('c_CodeDeploymentSchedule'),
                storyPointsInRelease,
                storyPoints
            );
        }
        return text;
    },
    _getStoryText: function(story, withoutHtml){

        var text = '';
        if (withoutHtml && story.get('FormattedID')){
            text = story.get('FormattedID');
        } else {
            var urlText = Ext.String.format("/{0}/{1}","userstory", story.get('ObjectID')),
                url = Rally.nav.Manager.getDetailUrl(urlText);

            text = Ext.String.format('<a href="{0}" target="_blank"><b>{1}</b></a>',url, story.get('FormattedID'));
        }
        text += ": " + story.get('Name');
        return text;

    },
    _constructColumns: function(){
        var me = this;
        var columns = [{
           xtype: 'treecolumn',
           text: 'Item',
           dataIndex: 'FormattedID',
           itemId: 'tree_column',
            width: '50%',
            scope: this,
           renderer: this._artifactRenderer
       },{
            text: 'State',
            dataIndex: 'ScheduleState',
            renderer: function(v, m, r){
                if (!r.get('FormattedID')){
                    m.tdCls = 'total';
                }
                if (v){
                    return v;
                } else {
                    if (r.get('State')){
                        return r.get('State').Name || '';
                    }
                }

            }
        },{
            text: 'Owner',
            dataIndex: 'Owner',
            renderer: function(v,m,r){
                if (v){
                    if (v._refObjectName){
                        return v._refObjectName;
                    }
                }
                return '';
            }
        }];
        
        Ext.each(Object.keys(this.iterationMap), function(key){
            columns.push({
                text: this.iterationMap[key],
                dataIndex: key,
              //  cls: 'iteration',
                width: 45,
                height: 100,
                renderTpl: '<div id="{id}-titleEl" role="presentation" class="x-column-header-inner iteration" style="padding-top: 44px; padding-bottom: 44px; width: 75px; text-align:left;"><span id="{id}-textEl" class="x-column-header-text iteration">{text}</span><div id="{id}-triggerEl" role="presentation" class="x-column-header-trigger" style="cursor: col-resize;"></div></div>',
                renderer: function(v,m,r){
                    m.tdCls = 'column-style';  //'column-style';
                    if (!r.get('FormattedID')){
                        m.tdCls = 'column-style total';
                    }
                    if (v > 0){
                        return v;
                    }
                    return '';
                }
            });
        },this);

        this.logger.log('_constructColumns',columns);
        return columns; 
    },

    getLinkByOid: function(objectType, objectId, linkText){
        var urlText = Ext.String.format("/{0}/{1}",objectType.toLowerCase(),objectId);
        var url = Rally.nav.Manager.getDetailUrl(urlText);
        return Ext.String.format('<a href="{0}" target="_blank">{1}</a>',url,linkText);
    },

    buildRoot: function(parentField, inputData){
        this.logger.log('buildRoot', inputData);
        var model_hash = Rally.technicalservices.util.TreeBuilding.prepareModelHash(inputData,parentField);
        
        model_hash = this._addColumnsAndBucketData(model_hash);
        var root_array = Rally.technicalservices.util.TreeBuilding.constructRootItems(model_hash);
        var me = this;
        Rally.technicalservices.util.TreeBuilding.rollup({root_items: root_array, field_name: this.unscheduledFieldName, leaves_only: true, calculator: function(item){return item.get(me.unscheduledFieldName) || 0;}});
        Rally.technicalservices.util.TreeBuilding.rollup({root_items: root_array, field_name: this.outsideReleaseFieldName, leaves_only: true, calculator:function(item){return item.get(me.outsideReleaseFieldName) || 0;}});
        Ext.each(Object.keys(this.iterationMap),function(key){
            Rally.technicalservices.util.TreeBuilding.rollup({root_items: root_array, field_name: key, leaves_only: true, calculator: function(item){return item.get(key) || 0;}});
        },this);
        root_array = Rally.technicalservices.util.TreeBuilding.convertModelsToHashes(root_array);

        var total_root = {};
        total_root['Name'] = 'Total';
        Ext.each(Object.keys(this.iterationMap), function(key){
            total_root[key] = 0;
        });
        total_root[this.unscheduledFieldName] =0 ;
        total_root[this.outsideReleaseFieldName] = 0;
        Ext.each(root_array, function(item){
            Ext.each(Object.keys(this.iterationMap), function(key){
                total_root[key] += item[key] ;
            });
            total_root[this.unscheduledFieldName] += item[this.unscheduledFieldName];
            total_root[this.outsideReleaseFieldName] += item[this.outsideReleaseFieldName];
        },this);

        total_root['children'] = [];
        root_array.push(total_root);
        this.logger.log('build: root_array',total_root);
        return root_array;
    },

    _addColumnsAndBucketData: function(model_hash){
        
        Ext.Object.each(model_hash, function(key, model){
            Ext.each(Object.keys(this.iterationMap), function(key){
                model.set(key, 0);
            });
            model.set(this.unscheduledFieldName,0);
            model.set(this.outsideReleaseFieldName,0);
            
            var model_iteration = this.unscheduledFieldName;
            if (model.get('Iteration')){
                model_iteration = this.outsideReleaseFieldName;
                var iteration_name = model.get('Iteration').Name;
                var key = Ext.Object.getKey(this.iterationMap, iteration_name);
                if (key){
                    model_iteration = key;
                }
            }
            if (model.get('PlanEstimate')){
                model.set(model_iteration,model.get('PlanEstimate'));
            } 
        }, this);
        this.logger.log('_addColumnsAndBucketData', model_hash, this.iterationMap);
        return model_hash; 
    },
    _getIterationNameFilter: function(releaseName){
        var iterationNameFilter = null;
        if (releaseName){
            var match = /Release ([\d]*)/.exec(releaseName);
            if (match && match.length > 1){
                return 'R' + match[1];
            }
        }
        return iterationNameFilter;
    }
});